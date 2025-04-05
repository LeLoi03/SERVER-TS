// src/fileHandler.ts

import fs from 'fs';

export const writeToCSV = async (filePath: string, headers: string, data: string[]): Promise<void> => {
    await fs.promises.writeFile(filePath, headers + data.join('\n'), 'utf8');
};

export const writeToJson = async (filePath: string, data: any): Promise<void> => {
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
};

// Thêm hàm append vào file
export const appendToCSV = async (filePath: string, data: string): Promise<void> => {
    await fs.promises.appendFile(filePath, data + '\n', 'utf8');
};

export const appendToJson = async (filePath: string, data: any): Promise<void> => {
    // Append JSON cần xử lý đặc biệt để giữ đúng định dạng
    try {
        let existingData: any[] = [];
        try {
          const existingContent = await fs.promises.readFile(filePath, 'utf8');
          existingData = JSON.parse(existingContent);  // Đọc dữ liệu hiện có
        } catch (readError: any) {
            // Nếu file chưa tồn tại, hoặc nội dung không phải JSON, mảng existingData sẽ rỗng
            if (readError.code !== 'ENOENT') { // ENOENT là lỗi "file not found"
                throw readError;  // Nếu là lỗi khác (không phải file not found), ném lỗi ra
            }
        }
        existingData.push(data);   // Thêm dữ liệu mới
        await fs.promises.writeFile(filePath, JSON.stringify(existingData, null, 2), 'utf8'); // Ghi lại toàn bộ
    } catch(error: any){
        console.error("Error appending to json file", error);
    }
};