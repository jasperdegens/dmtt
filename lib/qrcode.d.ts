declare module "qrcode" {
  interface QRCodeColorOptions {
    dark?: string;
    light?: string;
  }

  interface QRCodeToDataURLOptions {
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    margin?: number;
    width?: number;
    color?: QRCodeColorOptions;
  }

  interface QRCodeModule {
    toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>;
  }

  const QRCode: QRCodeModule;
  export default QRCode;
}
