// test_api.js
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
// Không cần readline nữa
// import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_CONFERENCE_ENDPOINT = 'http://172.188.242.233:3001/api/v1/crawl-conferences';
const API_JOURNAL_ENDPOINT = 'http://172.188.242.233:3001/api/v1/crawl-journals';
const CSV_FILE_PATH = './conferences_list.csv';

// <<< --- Cấu hình chế độ chạy --- >>>
const USE_CLIENT_DATA = true;  // true: Đọc từ CSV, false: Gọi API không kèm data
const ENABLE_CHUNKING = false; // true: Chia thành chunks, false: Gửi tất cả cùng lúc (chỉ áp dụng nếu USE_CLIENT_DATA=true)
const CHUNK_SIZE = 5;          // Kích thước chunk nếu ENABLE_CHUNKING=true


// --- Hàm crawlJournals (giữ lại nếu cần) ---
async function crawlJournals() {
    try {
        const CRAWL_MODE = 'csv';
        const response = await axios.post(API_JOURNAL_ENDPOINT, null, {
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
    } catch (error) {
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

crawlJournals();




// // Cralw conference ----------------------------
// import axios from 'axios';
// import fs from 'fs';
// import path from 'path';
// import { fileURLToPath } from 'url';
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// const API_CONFERENCE_ENDPOINT = 'http://172.188.242.233:3001/api/v1/crawl-conferences';
// // const API_JOURNAL_ENDPOINT = 'http://localhost:3001/crawl-journals'; // Giữ lại nếu bạn cũng test journal

// // *** Đặt thành true để test luồng UPDATE và nhận kết quả ***
// const USE_CLIENT_DATA = true;
// // *** Hoặc đặt thành false để test luồng CRAWL/SAVE (chỉ nhận xác nhận file) ***
// // const USE_CLIENT_DATA = false;


// // Dữ liệu mẫu chỉ dùng khi USE_CLIENT_DATA = true
// const conferences = [
//     // {
//     //     "Title": "ACM SIGMOD-SIGACT-SIGART Conference on Principles of Database Systems",
//     //     "Acronym": "PODS",
//     //     "mainLink": "https://2025.sigmod.org/",
//     //     "cfpLink": "",
//     //     "impLink": "",
//     // },
//     {
//         cfpLink: 'https://raid2025.github.io/call.html',
//         impLink: '',
//         Acronym: 'RAID',
//         Title: 'The International Symposium on Research in Attacks, Intrusions and Defenses',
//         mainLink: 'https://raid2025.github.io/'
//     }

// ];

// async function crawlConferences() {
//     console.log(`--- Starting Conference Test (Using Client Data: ${USE_CLIENT_DATA}) ---`);
//     try {
//         let params = {};
//         let requestData = null; // Đổi tên biến để rõ ràng hơn

//         if (USE_CLIENT_DATA) {
//             params = { dataSource: 'client' };
//             requestData = conferences; // Sử dụng dữ liệu conference
//             console.log('Sending client data:', JSON.stringify(requestData, null, 2));
//         } else {
//             params = { dataSource: 'api' };
//             console.log('Using API data source (no request body sent).');
//         }

//         const response = await axios.post(API_CONFERENCE_ENDPOINT, requestData, { // Gửi requestData
//             params: params,
//             headers: {
//                 'Content-Type': 'application/json'
//             }
//         });

//         // Log thông tin chung từ response
//         console.log('\n--- Backend Response ---');
//         console.log('Status:', response.status);
//         console.log('Message:', response.data.message);
//         console.log('Runtime:', response.data.runtime);
//         // Luôn log đường dẫn file output nếu có
//         if (response.data.outputJsonlPath) {
//             console.log('Output JSONL Path:', response.data.outputJsonlPath);
//         }
//         if (response.data.outputCsvPath) {
//             console.log('Output CSV Path:', response.data.outputCsvPath);
//         }


//         // *** THAY ĐỔI: Kiểm tra và log trường 'data' ***
//         if (USE_CLIENT_DATA && response.data.data) {
//             // Kiểm tra xem data có phải là mảng và có phần tử không
//             if (Array.isArray(response.data.data) && response.data.data.length > 0) {
//                 console.log(`\n--- Processed Results Received (${response.data.data.length}) ---`);
//                 // Log kết quả nhận được
//                 console.log(JSON.stringify(response.data.data, null, 2));
//             } else if (Array.isArray(response.data.data) && response.data.data.length === 0) {
//                 console.log('\n--- Processed Results Received (Empty Array) ---');
//                 console.log("The process completed, but the returned data array is empty.");
//             } else {
//                 // Trường hợp response.data.data tồn tại nhưng không phải mảng hợp lệ
//                 console.warn('\n--- Warning: Received "data" field is not a non-empty array ---');
//                 console.log('Raw "data" field:', response.data.data);
//             }
//         } else if (USE_CLIENT_DATA) {
//             // Trường hợp dataSource=client nhưng không có trường 'data'
//             console.log('\n--- No "data" field received in the response despite using client data source. ---');
//             // Có thể log toàn bộ response.data để debug
//             // console.log('Full Response Data:', JSON.stringify(response.data, null, 2));
//         } else {
//             // Trường hợp dataSource=api, không mong đợi 'data'
//             console.log('\n--- API data source used. Results written to server files (no data returned in response body). ---');
//         }
//         // --- Kết thúc thay đổi ---

//         // Bỏ đi log 'Data:' cũ vì đã thay bằng 'data'
//         // if (response.data.data) {
//         //     console.log('Data:', JSON.stringify(response.data.data, null, 2));
//         // }

//     } catch (error) {
//         console.error('\n--- Error Occurred ---');
//         // Log lỗi chi tiết hơn
//         if (error.response) {
//             // Lỗi từ phía server (status code không phải 2xx)
//             console.error('Error Status:', error.response.status);
//             console.error('Error Message from Server:', error.response.data?.message || 'No message field');
//             console.error('Error Details:', JSON.stringify(error.response.data?.error || error.response.data, null, 2)); // Log lỗi chi tiết hơn nếu có
//         } else if (error.request) {
//             // Request đã được gửi nhưng không nhận được response
//             console.error('Error Request:', 'No response received from the server. Is the server running?');
//             console.error('API Endpoint:', API_CONFERENCE_ENDPOINT);
//         } else {
//             // Lỗi xảy ra khi thiết lập request
//             console.error('Error Setting Up Request:', error.message);
//         }
//         // Log thêm config của request có thể hữu ích khi debug
//         // console.error('Request Config:', error.config);
//     } finally {
//         console.log('\n--- Test Finished ---');
//     }
// }

// // Gọi hàm test
// crawlConferences();



