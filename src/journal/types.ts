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