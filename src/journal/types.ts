export interface CSVRow {
    [key: string]: string;
  }

export interface TableRowData {
    csvRow: string;
    journalLink: string | null;
    journalName: string | null;
    country: string;
}

export interface JournalDetails {
    [key: string]: any;  // Allows dynamic properties
}

export interface ImageResult {
    Image: string | null;
    Image_Context: string | null;
}



import { Writable } from 'stream'; // Import Writable để kế thừa


// --- Interface tùy chỉnh cho Pino Destination Stream ---
// Interface này mô tả cấu trúc mong đợi của đối tượng trả về từ pino.destination({ sync: false })
// Kế thừa Writable để có các phương thức stream như .on() và thêm flushSync()
export interface PinoFileDestination extends Writable {
    flushSync(): void;
    // Có thể thêm các phương thức/thuộc tính khác nếu cần trong tương lai
    // destroy?(): void;
    // reopen?(file?: string): void;
}
