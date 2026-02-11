import os
import re
import time
import base64
import datetime
import logging
import shutil  # 新增：用于移动文件
import pdfplumber
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from openai import OpenAI
import lark_oapi
from lark_oapi.api.drive.v1 import *
from lark_oapi.api.bitable.v1 import (
    CreateAppTableRecordRequest,
    AppTableRecord
)

# ================= Config =================
# 1.  (AI Config) 
SILICON_API_KEY = ""  # 请替换为你的 Silicon API Key
BASE_URL = "https://api.siliconflow.cn/v1"
MODEL_NAME = "Qwen/Qwen2-VL-72B-Instruct" 

# 2. 飞书config(使用自己在飞书开发者平台创建的应用信息)
APP_ID = ""
APP_SECRET = ""
BASE_TOKEN = "" 
TABLE_ID = ""

# 3. files config
INVOICE_DIR = os.path.join(os.getcwd(), "invoices")
FAIL_DIR = os.path.join(os.getcwd(), "fail")  # 新增：失败文件存放路径
MAX_UPLOAD_WORKERS = 5

# log init
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s', datefmt='%H:%M:%S')

# init API client server
ai_client = OpenAI(api_key=SILICON_API_KEY, base_url=BASE_URL)
lark_client = lark_oapi.Client.builder().app_id(APP_ID).app_secret(APP_SECRET).build()

# ================= Helper: Move Failed Files =================
def move_to_fail(file_path):
    """将处理失败的文件移动到 fail 文件夹"""
    try:
        if not os.path.exists(FAIL_DIR):
            os.makedirs(FAIL_DIR)
        
        file_name = os.path.basename(file_path)
        dst_path = os.path.join(FAIL_DIR, file_name)
        
        # 如果目标文件夹已有同名文件，先删除目标文件（或者你可以选择重命名）
        if os.path.exists(dst_path):
            os.remove(dst_path)
            
        shutil.move(file_path, dst_path)
        logging.warning(f"🚫 [识别失败] 文件已移至 fail 目录: {file_name}")
    except Exception as e:
        logging.error(f"移动文件失败 {file_path}: {e}")

# ================= 1. AI detect =================

def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def extract_price_via_ai(image_path):
    try:
        base64_image = encode_image(image_path)
        
        # prompt for AI to detect
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
            temperature=0.1,
            max_tokens=20
        )
        
        content = response.choices[0].message.content.strip()
        # filter
        prices = re.findall(r'\d+\.\d{2}|\d+\.\d{1}|\d+', content)
        
        if prices:
            logging.info(f"🔍 AI 识别结果 ({os.path.basename(image_path)}): {prices[0]}")
            return float(prices[0])
        return None
    except Exception as e:
        logging.error(f"AI 请求失败 {os.path.basename(image_path)}: {e}")
        return None

# ================= 2. 发票解析=================

def extract_invoice_data(pdf_path):
    try:
        with pdfplumber.open(pdf_path) as pdf:
            if not pdf.pages: return None
            text = pdf.pages[0].extract_text() or ""
            
            # get date
            date_ts = int(time.time() * 1000)
            date_match = re.search(r'(\d{4})\s*[年-]\s*(\d{1,2})\s*[月-]\s*(\d{1,2})', text)
            if date_match:
                y, m, d = date_match.groups()
                date_ts = int(datetime.datetime(int(y), int(m), int(d)).timestamp() * 1000)
            
            # get amount 
            amount = 0.0
            amount_match = re.search(r'价税合计.*?[￥¥]?\s*([\d,]+\.\d{2})', text)
            if not amount_match:
                amount_match = re.search(r'小写.*?[￥¥]\s*([\d,]+\.\d{2})', text)
            
            if amount_match:
                amount = float(amount_match.group(1).replace(',', ''))
                
            return (os.path.basename(pdf_path), date_ts, amount)
    except Exception as e:
        logging.warning(f"发票解析异常 {os.path.basename(pdf_path)}: {e}")
        return None

# ================= 3. 飞书上传与写入 =================

def upload_single_file(file_path):
    try:
        if not file_path: return None
        file_size = os.path.getsize(file_path)
        file_name = os.path.basename(file_path)
        with open(file_path, "rb") as f:
            req = UploadAllFileRequest.builder().request_body(
                UploadAllFileRequestBody.builder()
                .file_name(file_name)
                .parent_type("bitable_file")
                .parent_node(BASE_TOKEN)
                .size(file_size)
                .file(f).build()
            ).build()
            resp = lark_client.drive.v1.file.upload_all(req)
            if resp.success(): return resp.data.file_token
            logging.error(f"文件上传失败 {file_name}: {resp.msg}")
            return None
    except Exception as e:
        logging.error(f"上传异常 {file_path}: {e}")
        return None

def process_upload_task(task):
    pdf, img, amount, date = task['pdf'], task['img'], task['amount'], task['date']
    logging.info(f"🚀 正在上传: 金额 {amount} 元的相关附件...")
    
    pdf_token = upload_single_file(pdf)
    img_token = upload_single_file(img)
    
    if pdf_token and img_token:
        fields = {
            "日期": date,
            "金额": amount,
            "发票": [{"file_token": pdf_token}],
            "订单截图": [{"file_token": img_token}]
        }
        
        record = AppTableRecord.builder() \
            .fields(fields) \
            .build()
            
        request = CreateAppTableRecordRequest.builder() \
            .app_token(BASE_TOKEN) \
            .table_id(TABLE_ID) \
            .request_body(record) \
            .build()

        response = lark_client.bitable.v1.app_table_record.create(request)
        
        if response.success():
            return f"✅ 归档成功: 金额 {amount}"
        else:
            return f"❌ 写入表格失败: {response.code} - {response.msg}"
            
    return f"❌ 上传附件失败，无法写入记录 (金额 {amount})"

# ================= 4. main =================

def main():
    if "sk-" not in SILICON_API_KEY:
        print("❌ 请先配置 SILICON_API_KEY")
        return

    if not os.path.exists(INVOICE_DIR): 
        os.makedirs(INVOICE_DIR)
        print(f"📁 已创建文件夹 {INVOICE_DIR}，请放入文件后运行。")
        return
    
    # 确保fail文件夹存在
    if not os.path.exists(FAIL_DIR):
        os.makedirs(FAIL_DIR)

    files = os.listdir(INVOICE_DIR)
    pdfs = [os.path.join(INVOICE_DIR, f) for f in files if f.lower().endswith('.pdf')]
    imgs = [os.path.join(INVOICE_DIR, f) for f in files if f.lower().endswith(('.jpg', '.png', '.jpeg'))]

    if not pdfs:
        print("⚠️ 文件夹内没有 PDF 发票")
        return

    print(f"📂 扫描结果: 发票 {len(pdfs)} 张, 截图 {len(imgs)} 张")

    # 1. pre-process (解析发票)
    invoice_pool = defaultdict(list)
    print("📄 正在解析 PDF 发票...")
    for pdf in pdfs:
        data = extract_invoice_data(pdf)
        if data and data[2] > 0:
            key = round(data[2], 2)
            invoice_pool[key].append({'path': pdf, 'date': data[1], 'amount': data[2]})
        else:
            # 🔴 解析失败或金额为0，移入fail
            move_to_fail(pdf)

    # 2. detect img and match (解析截图并匹配)
    tasks = []
    print("🤖 正在调用 AI 提取截图金额并进行模糊匹配...")
    
    for img in imgs:
        price = extract_price_via_ai(img)
        if price:
            key_price = round(price, 2)
            if invoice_pool[key_price]:
                matched_inv = invoice_pool[key_price].pop(0)
                tasks.append({
                    'pdf': matched_inv['path'],
                    'img': img,
                    'amount': key_price,
                    'date': matched_inv['date']
                })
                print(f"   🔗 [匹配成功] 金额: {key_price} 元 | 发票: {os.path.basename(matched_inv['path'])}")
            else:
                logging.warning(f"   ⚠️  [未找到匹配] 截图金额 {key_price} 元，无对应发票。")
                # 注意：这里是识别成功但没匹配上，根据需求，如果不希望移动未匹配的文件，就不调用 move_to_fail
                # 如果希望未匹配的也移走，可以在这里调用 move_to_fail(img)
        else:
            # 🔴 AI识别失败，移入fail
            move_to_fail(img)

    # 3. upload
    if tasks:
        print(f"\n🚀 开始并发同步至飞书 (线程数: {MAX_UPLOAD_WORKERS})...")
        with ThreadPoolExecutor(max_workers=MAX_UPLOAD_WORKERS) as executor:
            futures = [executor.submit(process_upload_task, t) for t in tasks]
            for future in as_completed(futures):
                try:
                    print(future.result())
                except Exception as e:
                    print(f"❌ 任务执行异常: {e}")
    else:
        print("\n😔 无匹配数据需要同步。")

    print(f"\n🏁 流程结束。识别失败的文件已移入 fail 文件夹。")

if __name__ == "__main__":
    main()