import os
import re
import time
import base64
import datetime
import logging
import shutil
import pdfplumber
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List

# FastAPI 相关
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import uvicorn

from openai import OpenAI
import lark_oapi
from lark_oapi.api.drive.v1 import *
from lark_oapi.api.bitable.v1 import (
    CreateAppTableRecordRequest,
    AppTableRecord
)

# ================= Config =================
SILICON_API_KEY = ""  # 🔴 替换 Key
BASE_URL = "https://api.siliconflow.cn/v1"
MODEL_NAME = "Qwen/Qwen2-VL-72B-Instruct" 

APP_ID = ""           # 🔴 替换 飞书 APP_ID
APP_SECRET = ""       # 🔴 替换 飞书 APP_SECRET
BASE_TOKEN = ""       # 🔴 替换 Token
TABLE_ID = ""         # 🔴 替换 Table ID

# 路径配置
CURRENT_DIR = os.getcwd()
INVOICE_DIR = os.path.join(CURRENT_DIR, "invoices")
FAIL_DIR = os.path.join(CURRENT_DIR, "fail")
MAX_UPLOAD_WORKERS = 5

# 初始化
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s', datefmt='%H:%M:%S')
ai_client = OpenAI(api_key=SILICON_API_KEY, base_url=BASE_URL)
lark_client = lark_oapi.Client.builder().app_id(APP_ID).app_secret(APP_SECRET).build()

app = FastAPI()
# 挂载静态文件目录
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

# 确保文件夹存在
os.makedirs(INVOICE_DIR, exist_ok=True)
os.makedirs(FAIL_DIR, exist_ok=True)

# ================= 核心逻辑 (保持原样) =================

def move_to_fail(file_path):
    """将处理失败的文件移动到 fail 文件夹"""
    try:
        if not os.path.exists(FAIL_DIR): os.makedirs(FAIL_DIR)
        file_name = os.path.basename(file_path)
        dst_path = os.path.join(FAIL_DIR, file_name)
        if os.path.exists(dst_path): os.remove(dst_path)
        shutil.move(file_path, dst_path)
        logging.warning(f"🚫 [识别失败] 文件已移至 fail 目录: {file_name}")
    except Exception as e:
        logging.error(f"移动文件失败 {file_path}: {e}")

def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def extract_price_via_ai(image_path):
    try:
        base64_image = encode_image(image_path)
        system_prompt = "你现在是一个专业的财务审计助手。任务：从提供的淘宝/电商订单截图中，精准识别‘实付款’（即用户最终支付的金额）。注意点：图中可能包含原价、划线价、省钱红包、店铺优惠等多种干扰数字，请务必只提取最终成交金额。输出格式：只输出数字部分（例如：128.50），不要包含货币符号或任何解释性文字。"
        user_prompt = "请查看这张截图，提取实付款金额。"

        response = ai_client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
                    ],
                }
            ],
            temperature=0.1, max_tokens=20
        )
        content = response.choices[0].message.content.strip()
        prices = re.findall(r'\d+\.\d{2}|\d+\.\d{1}|\d+', content)
        if prices: return float(prices[0])
        return None
    except Exception as e:
        logging.error(f"AI 请求失败 {os.path.basename(image_path)}: {e}")
        return None

def extract_invoice_data(pdf_path):
    try:
        with pdfplumber.open(pdf_path) as pdf:
            if not pdf.pages: return None
            text = pdf.pages[0].extract_text() or ""
            date_ts = int(time.time() * 1000)
            date_match = re.search(r'(\d{4})\s*[年-]\s*(\d{1,2})\s*[月-]\s*(\d{1,2})', text)
            if date_match:
                y, m, d = date_match.groups()
                date_ts = int(datetime.datetime(int(y), int(m), int(d)).timestamp() * 1000)
            amount = 0.0
            amount_match = re.search(r'价税合计.*?[￥¥]?\s*([\d,]+\.\d{2})', text)
            if not amount_match: amount_match = re.search(r'小写.*?[￥¥]\s*([\d,]+\.\d{2})', text)
            if amount_match: amount = float(amount_match.group(1).replace(',', ''))
            return (os.path.basename(pdf_path), date_ts, amount)
    except Exception as e:
        logging.warning(f"发票解析异常 {os.path.basename(pdf_path)}: {e}")
        return None

def upload_single_file(file_path):
    try:
        if not file_path: return None
        file_size = os.path.getsize(file_path)
        file_name = os.path.basename(file_path)
        with open(file_path, "rb") as f:
            req = UploadAllFileRequest.builder().request_body(
                UploadAllFileRequestBody.builder().file_name(file_name)
                .parent_type("bitable_file").parent_node(BASE_TOKEN)
                .size(file_size).file(f).build()
            ).build()
            resp = lark_client.drive.v1.file.upload_all(req)
            if resp.success(): return resp.data.file_token
            return None
    except Exception: return None

def process_upload_task(task):
    pdf, img, amount, date = task['pdf'], task['img'], task['amount'], task['date']
    pdf_token = upload_single_file(pdf)
    img_token = upload_single_file(img)
    
    if pdf_token and img_token:
        fields = {
            "日期": date, "金额": amount,
            "发票": [{"file_token": pdf_token}], "订单截图": [{"file_token": img_token}]
        }
        record = AppTableRecord.builder().fields(fields).build()
        req = CreateAppTableRecordRequest.builder().app_token(BASE_TOKEN)\
            .table_id(TABLE_ID).request_body(record).build()
        resp = lark_client.bitable.v1.app_table_record.create(req)
        
        if resp.success(): return f"✅ 归档成功: {amount}元"
    return f"❌ 归档失败: {amount}元"

# ================= 业务逻辑封装 (供API调用) =================

def run_processing_logic():
    logs = []
    files = os.listdir(INVOICE_DIR)
    pdfs = [os.path.join(INVOICE_DIR, f) for f in files if f.lower().endswith('.pdf')]
    imgs = [os.path.join(INVOICE_DIR, f) for f in files if f.lower().endswith(('.jpg', '.png', '.jpeg'))]

    if not pdfs: return ["⚠️ 没有发现 PDF 发票"]

    # 1. 解析发票
    invoice_pool = defaultdict(list)
    for pdf in pdfs:
        data = extract_invoice_data(pdf)
        if data and data[2] > 0:
            key = round(data[2], 2)
            invoice_pool[key].append({'path': pdf, 'date': data[1], 'amount': data[2]})
        else:
            move_to_fail(pdf)
            logs.append(f"🚫 发票无效移入Fail: {os.path.basename(pdf)}")

    # 2. 匹配截图
    tasks = []
    for img in imgs:
        price = extract_price_via_ai(img)
        if price:
            key_price = round(price, 2)
            if invoice_pool[key_price]:
                matched_inv = invoice_pool[key_price].pop(0)
                tasks.append({'pdf': matched_inv['path'], 'img': img, 'amount': key_price, 'date': matched_inv['date']})
            else:
                logs.append(f"⚠️ 截图金额 {key_price} 无对应发票")
        else:
            move_to_fail(img)
            logs.append(f"🚫 AI识别失败移入Fail: {os.path.basename(img)}")

    # 3. 并发上传
    if tasks:
        with ThreadPoolExecutor(max_workers=MAX_UPLOAD_WORKERS) as executor:
            futures = [executor.submit(process_upload_task, t) for t in tasks]
            for future in as_completed(futures):
                logs.append(future.result())
    else:
        logs.append("无有效匹配任务")
    
    return logs

# ================= API 接口 =================

@app.get("/")
async def read_index():
    return FileResponse('static/index.html')

@app.get("/files")
def list_files():
    files = os.listdir(INVOICE_DIR)
    return {"files": files}

@app.post("/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    for file in files:
        path = os.path.join(INVOICE_DIR, file.filename)
        with open(path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    return {"message": "ok"}

@app.delete("/files/{filename}")
def delete_file(filename: str):
    path = os.path.join(INVOICE_DIR, filename)
    if os.path.exists(path):
        os.remove(path)
        return {"status": "deleted"}
    raise HTTPException(status_code=404, detail="File not found")

@app.post("/run")
def run_process():
    logs = run_processing_logic()
    return {"logs": logs}

if __name__ == "__main__":
    print("🚀 服务已启动，请访问: http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)