export type ScanResult = { status: "CLEAN" | "REJECTED" | "UNAVAILABLE"; reason?: string };

export interface AttachmentScanner {
  scan(bytes: Buffer, mimeType: string): Promise<ScanResult>;
}

export class NoOpAttachmentScanner implements AttachmentScanner {
  async scan(): Promise<ScanResult> {
    return { status: "UNAVAILABLE", reason: "No external malware scanner is configured" };
  }
}
