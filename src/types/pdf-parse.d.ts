declare module "pdf-parse" {
  export type PDFData = {
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    text: string;
    version: string;
  };

  export default function pdfParse(dataBuffer: Buffer): Promise<PDFData>;
}

