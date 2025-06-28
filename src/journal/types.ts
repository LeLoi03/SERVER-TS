export type CSVRecord = {
    Rank?: string;
    Sourceid?: string;
    Title?: string;
    Type?: string;
    Issn?: string;
    SJR?: string;
    'SJR Best Quartile'?: string;
    'H index'?: string;
    'Total Docs. (2024)'?: string;
    'Total Docs. (3years)'?: string;
    'Total Refs.'?: string;
    'Total Cites (3years)'?: string;
    'Citable Docs. (3years)'?: string;
    'Cites / Doc. (2years)'?: string;
    'Ref. / Doc.'?: string;
    '%Female'?: string; // Ensure keys match CSV headers exactly
    Overton?: string;
    SDG?: string;
    Country?: string;
    Region?: string;
    Publisher?: string;
    Coverage?: string;
    Categories?: string;
    Areas?: string;
    // Add any other potential columns
    [key: string]: string | undefined; // Allow for extra columns
};

// Also update CSVRow type if it's different from CSVRecord
export type CSVRow = CSVRecord;

export interface TableRowData {
    csvRow: string;
    journalLink: string | null;
    journalName: string | null;
    issn : string | null;
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
