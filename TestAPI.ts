import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';

// Define types for better type safety
interface Conference {
    Title: string;
    Acronym: string;
}

interface ApiResponse {
    message: string;
    runtime: number;
    data?: any; // Replace 'any' with a more specific type if possible
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_CONFERENCE_ENDPOINT = 'http://localhost:3001/crawl-conferences';
const API_JOURNAL_ENDPOINT = 'http://localhost:3001/crawl-journals';
const CSV_FILE_PATH = './CORE_2023.csv';

// <<< --- Cấu hình chế độ chạy --- >>>
const USE_CLIENT_DATA = true;  // true: Đọc từ CSV, false: Gọi API không kèm data
const ENABLE_CHUNKING = false; // true: Chia thành chunks, false: Gửi tất cả cùng lúc (chỉ áp dụng nếu USE_CLIENT_DATA=true)
const CHUNK_SIZE = 5;          // Kích thước chunk nếu ENABLE_CHUNKING=true

// --- Hàm đọc và parse CSV (như trước) ---
function readAndParseCSV(filePath: string): Conference[] {
    console.log(`Đang đọc file CSV từ: ${filePath}`);
    try {
        const fileContent = fs.readFileSync(filePath, { encoding: 'utf8' });
        const records: string[][] = parse(fileContent, {  // Explicitly type records as string[][]
            columns: false, skip_empty_lines: true, trim: true, relax_column_count: true
        });

        const conferences: Conference[] = records.map(record => {
            if (record && record.length > 2) {
                return {
                    Title: record[1]?.trim() ?? '', // Sử dụng optional chaining và nullish coalescing cho an toàn
                    Acronym: record[2]?.trim() ?? ''
                };
            }
            return null;
        }).filter((conf): conf is Conference => conf !== null && conf.Title !== '' && conf.Acronym !== ''); // Lọc chặt chẽ hơn and type guard

        console.log(`Đã đọc và xử lý thành công ${conferences.length} conferences từ file CSV.`);
        return conferences;
    } catch (error) {
        console.error(`Lỗi khi đọc hoặc parse file CSV: ${filePath}`, error);
        return [];
    }
}

// --- Hàm chia mảng thành các chunks (như trước) ---
function chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

// --- Hàm gửi payload dữ liệu conference ---
async function sendConferenceDataPayload(conferencePayload: Conference[], description = "Data Payload"): Promise<boolean> {
    console.log(`\n--- Đang gửi ${description} (${conferencePayload.length} conferences) ---`);
    try {
        const params = { dataSource: 'client' }; // Luôn là client khi gửi payload
        const response = await axios.post<ApiResponse>(API_CONFERENCE_ENDPOINT, conferencePayload, { // Typed response
            params: params,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log(`${description} - Status:`, response.status);
        console.log(`${description} - Message:`, response.data.message);
        console.log(`${description} - Runtime:`, response.data.runtime);
        // console.log(`${description} - Data:`, JSON.stringify(response.data.data, null, 2));
        console.log(`--- Gửi ${description} thành công ---`);
        return true;

    } catch (error: any) { // Explicitly type error as any for now (or AxiosError for more precision)
        console.error(`\n!!! Lỗi khi gửi ${description}:`, error.message);
        if (error.response) {
            console.error('Server Response Status:', error.response.status);
            console.error('Server Response Data:', JSON.stringify(error.response.data, null, 2));
        } else if (error.request) {
            console.error('Không nhận được phản hồi từ server.');
        } else {
            console.error('Lỗi khi thiết lập request:', error.message);
        }
        console.log(`--- Gửi ${description} thất bại ---`);
        return false;
    }
}

// --- Hàm chính crawlConferences với các tùy chọn ---
async function crawlConferences(): Promise<void> {
    if (USE_CLIENT_DATA) {
        // --- Luồng xử lý dữ liệu từ Client (CSV) ---
        console.log("Chế độ: Sử dụng dữ liệu từ file CSV (client).");
        const allConferences = readAndParseCSV(CSV_FILE_PATH);

        if (allConferences.length === 0) {
            console.log("Không có conference nào trong file CSV để gửi.");
            return;
        }

        if (ENABLE_CHUNKING) {
            // --- Gửi theo Chunks ---
            console.log(`Chia chunk: Bật (Kích thước: ${CHUNK_SIZE}). Gửi tuần tự từng chunk.`);
            const conferenceChunks = chunkArray(allConferences, CHUNK_SIZE);
            const totalChunks = conferenceChunks.length;
            console.log(`Tổng số chunks: ${totalChunks}.`);

            for (let i = 0; i < totalChunks; i++) {
                const currentChunk = conferenceChunks[i];
                const description = `Chunk ${i + 1}/${totalChunks}`;
                const success = await sendConferenceDataPayload(currentChunk, description);

                if (!success) {
                    console.log(`\n!!! Dừng quá trình gửi do lỗi ở ${description}.`);
                    break;
                }
            }
            console.log("\n--- Hoàn tất quá trình gửi các chunks (hoặc đã dừng do lỗi) ---");

        } else {
            // --- Gửi tất cả cùng lúc ---
            console.log("Chia chunk: Tắt. Gửi toàn bộ danh sách trong một lần.");
            const description = "Toàn bộ danh sách";
            await sendConferenceDataPayload(allConferences, description);
            console.log("\n--- Hoàn tất gửi toàn bộ danh sách ---");
        }

    } else {
        // --- Luồng xử lý yêu cầu API không kèm dữ liệu client ---
        console.log("Chế độ: Yêu cầu dữ liệu từ API (server, dataSource=api).");
        try {
            const params = { dataSource: 'api' };
            const response = await axios.post<ApiResponse>(API_CONFERENCE_ENDPOINT, null, { // Typed response
                params: params
            });

            console.log('Status:', response.status);
            console.log('Message:', response.data.message);
            console.log('Runtime:', response.data.runtime);
            if (response.data.data) {
                console.log('Data:', JSON.stringify(response.data.data, null, 2));
            }
        } catch (error: any) { // Explicitly type error as any
            console.error('Lỗi khi gọi API chế độ dataSource=api:', error.message);
            if (error.response) {
                console.error('Server Response Status:', error.response.status);
                console.error('Server Response Data:', JSON.stringify(error.response.data, null, 2));
            } else if (error.request) {
                console.error('Không nhận được phản hồi từ server.');
            } else {
                console.error('Lỗi khi thiết lập request:', error.message);
            }
        }
    }
}

// --- Hàm crawlJournals (giữ lại nếu cần) ---
async function crawlJournals(): Promise<void> {
    try {
        const CRAWL_MODE = 'csv';
        const response = await axios.post<ApiResponse>(API_JOURNAL_ENDPOINT, null, { // Typed response
            params: { CRAWL_MODE },
        });
        console.log('\n--- Bắt đầu Crawl Journals ---');
        console.log('Journal Status:', response.status);
        console.log('Journal Message:', response.data.message);
        console.log('Journal Runtime:', response.data.runtime);
        fs.writeFileSync(path.join(__dirname, 'journal_api_log.json'), JSON.stringify(response.data.data || response.data, null, 2), 'utf8');
        if (response.data.data) {
            console.log('Journal Data:', JSON.stringify(response.data.data, null, 2));
        }
        console.log('--- Kết thúc Crawl Journals ---');
    } catch (error: any) { // Explicitly type error as any
        console.error('\nLỗi khi gọi API crawlJournals:', error.message);
        if (error.response) {
            console.error('Server Response Status:', error.response.status);
            console.error('Server Response Data:', JSON.stringify(error.response.data, null, 2));
        } else if (error.request) {
            console.error('Không nhận được phản hồi từ server.');
        } else {
            console.error('Lỗi khi thiết lập request:', error.message);
        }
    }
}

// *** Chạy hàm ***
crawlConferences();
// crawlJournals(); // Bỏ comment nếu muốn chạy