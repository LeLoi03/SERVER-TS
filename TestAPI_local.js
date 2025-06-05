// test_api.js
import axios from 'axios';
// fs, path, fileURLToPath, __filename, __dirname không cần thiết cho bản test này nữa
// trừ khi bạn muốn đọc dữ liệu từ file.

const API_CONFERENCE_ENDPOINT = 'http://localhost:3001/api/v1/crawl-conferences';

// *** Cấu hình cho test ***
const TEST_DESCRIPTION = "Test crawl request from test_api.js"; // Mô tả cho request
// const TEST_DESCRIPTION = ""; // Test với description rỗng
// const TEST_DESCRIPTION = undefined; // Test với không có key description (FE sẽ không gửi key nếu rỗng)

const API_MODELS_TO_USE = {
    determineLinks: 'tuned', // 'tuned', 'non-tuned', hoặc null (để BE dùng default)
    extractInfo: 'tuned',
    extractCfp: 'non-tuned'
};
// Hoặc để test trường hợp BE dùng default:
// const API_MODELS_TO_USE = {
//     determineLinks: null,
//     extractInfo: null,
//     extractCfp: null
// };

// Dữ liệu mẫu cho items
const conferenceItems = [
    {
        "Title": "ACM SIGMOD-SIGACT-SIGART Conference on Principles of Database Systems",
        "Acronym": "PODS",
        // Luồng CRAWL (không có mainLink, cfpLink, impLink)
    },
    // {
    //     "Title": "International Conference on Machine Learning",
    //     "Acronym": "ICML",
    //     // Luồng CRAWL
    // },
    // {
    //     "Title": "Conference on Neural Information Processing Systems",
    //     "Acronym": "NeurIPS",
    //     "mainLink": "https://nips.cc/", // Ví dụ cho luồng UPDATE (FE sẽ gửi nếu crawlType là update)
    //     "cfpLink": "https://nips.cc/Conferences/2024/CallForPapers",
    //     "impLink": null, // Ví dụ impLink không có
    // },
];

async function crawlConferences() {
    console.log(`--- Starting Conference Test ---`);
    try {
        // Xây dựng payload mới
        const requestPayload = {
            items: conferenceItems,
            models: API_MODELS_TO_USE,
        };

        // Thêm description vào payload nếu nó được định nghĩa và không phải undefined
        // Nếu TEST_DESCRIPTION là undefined, key 'description' sẽ không được thêm vào payload,
        // mô phỏng việc FE không gửi key này nếu người dùng không nhập.
        if (typeof TEST_DESCRIPTION !== 'undefined') {
            requestPayload.description = TEST_DESCRIPTION;
        }


        console.log('Sending API request with payload:');
        console.log(JSON.stringify(requestPayload, null, 2));

        // dataSource vẫn là query parameter
        const params = { dataSource: 'client' };

        const response = await axios.post(API_CONFERENCE_ENDPOINT, requestPayload, {
            params: params,
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 120000 // Tăng timeout nếu cần cho các request lớn
        });

        console.log('\n--- Backend Response ---');
        console.log('Status:', response.status);
        console.log('Message:', response.data.message);
        console.log('Runtime:', response.data.runtime);
        console.log('Description Received by Server:', response.data.description); // Log description BE trả về

        if (response.data.outputJsonlPath) {
            console.log('Output JSONL Path:', response.data.outputJsonlPath);
        }
        if (response.data.outputCsvPath) {
            console.log('Output CSV Path:', response.data.outputCsvPath);
        }

        if (response.data.data) {
            if (Array.isArray(response.data.data) && response.data.data.length > 0) {
                console.log(`\n--- Processed Results Received (${response.data.data.length}) ---`);
                // console.log(JSON.stringify(response.data.data, null, 2)); // Có thể rất dài
                console.log("First processed result sample:", JSON.stringify(response.data.data[0], null, 2));
                if (response.data.data.length > 1) {
                    console.log("Last processed result sample:", JSON.stringify(response.data.data[response.data.data.length - 1], null, 2));
                }
            } else if (Array.isArray(response.data.data) && response.data.data.length === 0) {
                console.log('\n--- Processed Results Received (Empty Array) ---');
                console.log("The process completed, but the returned data array is empty.");
            } else {
                console.warn('\n--- Warning: Received "data" field is not a non-empty array ---');
                console.log('Raw "data" field:', response.data.data);
            }
        } else {
            console.log('\n--- No "data" field received in the response. ---');
        }

    } catch (error) {
        console.error('\n--- Error Occurred ---');
        if (error.response) {
            console.error('Error Status:', error.response.status);
            console.error('Error Message from Server:', error.response.data?.message || 'No message field');
            console.error('Error Details:', JSON.stringify(error.response.data?.error || error.response.data, null, 2));
            if (error.response.data?.description) {
                 console.error('Request Description (from error response):', error.response.data.description);
            }
        } else if (error.request) {
            console.error('Error Request:', 'No response received from the server. Is the server running?');
            console.error('API Endpoint:', API_CONFERENCE_ENDPOINT);
        } else {
            console.error('Error Setting Up Request:', error.message);
        }
    } finally {
        console.log('\n--- Test Finished ---');
    }
}

// Gọi hàm test
crawlConferences();