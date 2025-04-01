import { pino } from 'pino';
import { LOG_FILE } from '../config.js';
import fs from 'fs/promises';
import { parse } from 'csv-parse/sync'; // Import thư viện csv-parse/sync

// Cấu hình logger (Pino)
const transport = pino.transport({
  target: 'pino/file',
  options: { destination: LOG_FILE, mkdir: true }, // Tạo thư mục nếu chưa tồn tại
});

export const logger = pino({
  level: 'info', // Đặt level log (debug, info, warn, error, fatal)
}, transport);

export const traverseNodes = (node: Node | null): string => {
  if (!node) return '';
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.trim() || ''; // Null safe access
  } else if (node.nodeType === Node.ELEMENT_NODE && node.childNodes.length > 0) {
    return Array.from(node.childNodes).map(traverseNodes).join(' ').trim();
  }
  return '';
};

export const createURLList = (baseURL: string, lastPageNumber: number): string[] => {
  return Array.from({ length: lastPageNumber }, (_, i) => `${baseURL}&page=${i + 1}`); // Corrected length
};

export const formatISSN = (issn: string): string | null => {
  const issnValues = issn.split(',').map(item => item.trim());
  const issnToSearch = issnValues[1] || issnValues[0];

  if (issnToSearch) {
    return issnToSearch.replace(/(\d{4})(\d{4})/, '$1-$2');
  }
  return null;
};

interface RetryOptions {
  retries: number;
  minTimeout: number;
  factor: number;
}

// Hàm retry bất đồng bộ
export const retryAsync = async <T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> => {
  const { retries, minTimeout, factor } = options;
  let attempt = 0;

  while (attempt < retries) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      if (attempt >= retries) {
        throw error; // Ném lỗi nếu đã thử lại quá số lần quy định
      }

      const timeout = minTimeout * Math.pow(factor, attempt - 1);
      logger.warn(`Attempt ${attempt} failed: ${error.message}. Retrying in ${timeout}ms...`);
      await new Promise((resolve) => setTimeout(resolve, timeout));
    }
  }
  throw new Error("Retry failed after multiple attempts"); // Should not happen, but good to have
};

interface CSVRecord {
  [key: string]: string;
}

export const readCSV = async (filePath: string): Promise<CSVRecord[]> => {
  try {
    const fileContent = await fs.readFile(filePath, { encoding: 'utf8' });
    const records: CSVRecord[] = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
    });
    return records;
  } catch (error: any) {
    logger.error(`Error read file csv ${filePath}: ${error}`);
    return [];
  }
};