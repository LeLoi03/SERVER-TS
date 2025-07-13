import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

// ========================================================================
// ---                          CẤU HÌNH TEST                          ---
// ========================================================================

const CONFIG = {
    SERVER_URL: 'http://localhost:3001',
    SOCKET_PATH: '/socket.io/',
    JWT_TOKEN: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJwYXlsb2FkIjp7ImlkIjoiOGQ0ODFmMTctZjBlMS00NDY1LWE4ZTEtMWQ2MTM2YTk3NzViIiwiZW1haWwiOiJmYW5uZWlob3VuYWZ1LTgwNDVAeW9wbWFpbC5jb20iLCJyb2xlIjoidXNlciJ9LCJpYXQiOjE3NTIzODQ2NDQsImV4cCI6MTc1MjQwNjI0NH0.tnwMd8YaKtc6VzQbVb5ICP95Sa8hVOmPYKL2uWY8I_4',
    DEFAULT_TEST_TIMEOUT_MS: 30000,
    FIRST_QUESTION_TIMEOUT_MS: 60000,
    // Thời gian chờ giữa các câu hỏi (ms) để không vượt quá 5 câu/phút
    QUESTION_INTERVAL_MS: 15000,
    LOG_RESPONSES_TO_FILE: true,
    LOG_FILE_NAME: `test-results-${new Date().toISOString().replace(/:/g, '-')}.json`
};

// ========================================================================
// ---                       DANH SÁCH CÂU HỎI & MODEL TEST              ---
// ========================================================================

const MODELS_TO_TEST = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite-preview-06-17',
    'gemini-2.5-pro',
];

const QUESTIONS_TO_TEST = [
    // === NHÓM 0: Chào hỏi đơn thuần ===
    { group: "0. Chào hỏi", question: "Xin chào" },
    { group: "0. Chào hỏi", question: "Bạn là ai?" },
    { group: "0. Chào hỏi", question: "Bạn có thể làm gì?" },

    // // === NHÓM 1: Theo từ khóa hoặc tên hội nghị ===
    // { group: "1. Từ khóa/Tên", question: "Tìm hội nghị có từ khóa ‘machine learning’" },
    // { group: "1. Từ khóa/Tên", question: "Cho mình biết về hội nghị tên là NeurIPS" },
    // { group: "1. Từ khóa/Tên", question: "Hội nghị nào có tên viết tắt là ACL?" },

    // // === NHÓM 2: Theo địa lý ===
    // { group: "2. Địa lý", question: "Có hội nghị nào diễn ra ở Việt Nam trong năm nay không?" },
    // { group: "2. Địa lý", question: "Liệt kê các hội nghị ở châu Á về AI vào quý 4 năm 2025" },
    // { group: "2. Địa lý", question: "Có hội nghị nào ở Mỹ, tổ chức offline trong tháng 10 không?" },

    // // === NHÓM 3: Theo mốc thời gian ===
    // { group: "3. Thời gian", question: "Hội nghị nào có ngày nộp bài trước 30/7/2025?" },
    // { group: "3. Thời gian", question: "Cho mình danh sách các hội nghị diễn ra từ tháng 9 đến tháng 11 năm 2025" },
    // { group: "3. Thời gian", question: "Hội nghị nào diễn ra vào đúng ngày 15/8/2025?" },

    // // === NHÓM 4: Theo đặc điểm hội nghị ===
    // { group: "4. Đặc điểm", question: "Tìm hội nghị về chủ đề Cybersecurity có rank A* theo CORE2023" },
    // { group: "4. Đặc điểm", question: "Hội nghị nào tổ chức hybrid và có chủ đề về NLP?" },
    // { group: "4. Đặc điểm", question: "Có hội nghị nào thuộc source Springer không?" },

    // // === NHÓM 5: Câu hỏi chi tiết ===
    // { group: "5. Chi tiết", question: "Cho mình chi tiết về hội nghị ICML 2025" },
    // { group: "5. Chi tiết", question: "ACL 2025 diễn ra ở đâu, ngày nào?" },
    // { group: "5. Chi tiết", question: "Deadline nộp bài của NeurIPS là khi nào?" },
    // { group: "5. Chi tiết", question: "Rank của hội nghị ICRA là gì?" },
    // { group: "5. Chi tiết", question: "Link CFP của hội nghị SIGGRAPH Asia 2025?" },

    // // === NHÓM 6: Dạng tóm tắt ===
    // { group: "6. Tóm tắt", question: "Tóm tắt ngắn gọn thông tin chính của hội nghị ECCV 2025" },

    // // === NHÓM III: Mở địa điểm / bản đồ ===
    // { group: "III. Bản đồ", question: "Mở bản đồ vị trí tổ chức hội nghị ICLR 2025" },
    // { group: "III. Bản đồ", question: "Chỉ đường đến địa điểm tổ chức hội nghị KDD 2025" },
    // { group: "III. Bản đồ", question: "Xem địa chỉ tổ chức CVPR 2025 trên Google Maps" },

    // // === NHÓM IV: Truy cập trang web hội nghị ===
    // { group: "IV. Web", question: "Mở website chính thức của EMNLP 2025" },
    // { group: "IV. Web", question: "Mở link thông tin hội nghị AAAI 2025" },
    // { group: "IV. Web", question: "Mở link call for papers của hội nghị ICDM 2025" },

    // // === NHÓM V: Hướng dẫn sử dụng ===
    // { group: "V. Hướng dẫn", question: "Làm sao để tìm hội nghị theo quý?" },
    // { group: "V. Hướng dẫn", question: "Mình có thể lọc hội nghị theo rank như thế nào?" },
    // { group: "V. Hướng dẫn", question: "Giải thích cách sử dụng bộ lọc theo thời gian diễn ra" },

    // // === NHÓM VI: Dữ liệu cá nhân (Giả định) ===
    // { group: "VI. Cá nhân", question: "Những hội nghị nào mình đã theo dõi?" },
    // { group: "VI. Cá nhân", question: "Hội nghị nào trong danh sách quan tâm của mình có deadline vào tháng 8?" },
    // { group: "VI. Cá nhân", question: "Mở danh sách các hội nghị mình đã thêm vào lịch" },
    // { group: "VI. Cá nhân", question: "Có hội nghị nào mình đã lưu vào lịch diễn ra tuần tới không?" },
    // { group: "VI. Cá nhân", question: "Hội nghị nào nằm trong danh sách đen của mình?" },
    // { group: "VI. Cá nhân", question: "Mình có từng cho ICANN vào blacklist không?" },

    // // === NHÓM VII: Câu hỏi phức tạp ===
    // { group: "VII. Phức tạp", question: "Tìm tất cả hội nghị diễn ra trong quý 3 năm 2025, ở châu Âu, có chủ đề là Data Mining, rank A theo CORE, tổ chức offline, deadline nộp bài trong tháng 7" },
    // { group: "VII. Phức tạp", question: "So sánh ngày diễn ra và rank của hội nghị NeurIPS và ICML 2025" },
    // { group: "VII. Phức tạp", question: "Trong các hội nghị mình đã theo dõi, có hội nghị nào trùng lịch với hội nghị mới tên là BigData 2025 không?" },
];


// ========================================================================
// ---                       CÁC ĐỊNH NGHĨA VÀ HÀM                      ---
// ========================================================================

interface QuestionInfo {
    group: string;
    question: string;
}

interface TestPayload {
    group: string;
    question: string;
    model: string;
}

interface TestResult {
    frontendMessageId: string;
    payload: TestPayload;
    status: 'SUCCESS' | 'ERROR' | 'TIMEOUT';
    roundTripTime_ms?: number;
    error?: string;
    response?: string;
}

function connectToServer(): Promise<Socket> {
    console.log(`Connecting to server at ${CONFIG.SERVER_URL} with path ${CONFIG.SOCKET_PATH}`);
    const socketOptions = {
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
        auth: { token: CONFIG.JWT_TOKEN },
        transports: ['websocket'],
        ...(CONFIG.SOCKET_PATH && CONFIG.SOCKET_PATH !== '/socket.io/' && { path: CONFIG.SOCKET_PATH }),
    };
    const socket = io(CONFIG.SERVER_URL, socketOptions);

    return new Promise((resolve, reject) => {
        socket.on('connect_error', (err) => {
            console.error(`❌ Connection failed: ${err.message}`);
            socket.off();
            reject(err);
        });
        socket.on('auth_error', (data) => {
            const message = (data as any)?.message || 'Authentication error';
            console.error(`❌ Authentication failed: ${message}`);
            socket.off();
            reject(new Error(message));
        });
        socket.on('server_error', (data) => {
            const message = (data as any)?.message || 'Server error';
            console.error(`❌ Server error on connect: ${message}`);
            socket.off();
            reject(new Error(message));
        });

        socket.on('connection_ready', (data) => {
            console.log(`✅ Server is ready! UserID: ${data.userId}`);
            socket.off('connect_error');
            socket.off('auth_error');
            socket.off('server_error');
            resolve(socket);
        });

        socket.on('connect', () => {
            console.log(`🔌 Socket connected with ID: ${socket.id}. Waiting for server to be ready...`);
        });
    });
}

function sendMessageAndMeasure(socket: Socket, payload: TestPayload, timeoutMs: number): Promise<TestResult> {
    return new Promise((resolve) => {
        const clientStartTime = Date.now();
        const frontendMessageId = uuidv4();
        let fullResponse = '';

        const timeoutId = setTimeout(() => {
            cleanupListeners();
            resolve({
                frontendMessageId,
                payload,
                status: 'TIMEOUT',
                roundTripTime_ms: Date.now() - clientStartTime,
                error: `Request timed out after ${timeoutMs / 1000}s`,
            });
        }, timeoutMs);

        const onChatUpdate = (data: { textChunk: string }) => {
            fullResponse += data.textChunk;
        };

        const onChatResult = () => {
            const clientEndTime = Date.now();
            cleanupListeners();
            clearTimeout(timeoutId);
            resolve({
                frontendMessageId,
                payload,
                status: 'SUCCESS',
                roundTripTime_ms: clientEndTime - clientStartTime,
                response: fullResponse,
            });
        };

        const onChatError = (data: { message: string }) => {
            const clientEndTime = Date.now();
            cleanupListeners();
            clearTimeout(timeoutId);
            resolve({
                frontendMessageId,
                payload,
                status: 'ERROR',
                roundTripTime_ms: clientEndTime - clientStartTime,
                error: data.message,
            });
        };

        const cleanupListeners = () => {
            socket.off('chat_update', onChatUpdate);
            socket.off('chat_result', onChatResult);
            socket.off('chat_error', onChatError);
        };

        socket.on('chat_update', onChatUpdate);
        socket.on('chat_result', onChatResult);
        socket.on('chat_error', onChatError);

        const messageData = {
            parts: [{ text: payload.question }],
            isStreaming: true,
            language: 'vi',
            frontendMessageId,
            model: payload.model,
        };

        console.log(`\n   -> Sending payload:`, JSON.stringify(messageData, null, 2));
        socket.emit('send_message', messageData);
    });
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runTests() {
    let socket: Socket | null = null;
    try {
        socket = await connectToServer();
        const allResults: TestResult[] = [];
        const totalQuestionsToRun = QUESTIONS_TO_TEST.length * MODELS_TO_TEST.length;
        let questionCounter = 0;

        console.log(`\n🚀 Starting performance test...`);
        console.log(`   - Models to test: ${MODELS_TO_TEST.join(', ')}`);
        console.log(`   - Questions per model: ${QUESTIONS_TO_TEST.length}`);
        console.log(`   - Total requests to send: ${totalQuestionsToRun}`);
        console.log(`   - Interval between questions: ${CONFIG.QUESTION_INTERVAL_MS / 1000}s`);
        console.log('--------------------------------------------------');

        for (const model of MODELS_TO_TEST) {
            console.log(`\n\n==================================================`);
            console.log(`=====      TESTING MODEL: ${model.toUpperCase()}      =====`);
            console.log(`==================================================`);

            for (const questionInfo of QUESTIONS_TO_TEST) {
                questionCounter++;

                const testPayload: TestPayload = {
                    group: questionInfo.group,
                    question: questionInfo.question,
                    model: model,
                };

                const timeoutForThisQuestion = (questionCounter === 1)
                    ? CONFIG.FIRST_QUESTION_TIMEOUT_MS
                    : CONFIG.DEFAULT_TEST_TIMEOUT_MS;

                console.log(`\n[${questionCounter}/${totalQuestionsToRun}] Testing...`);
                console.log(`  > Group:    "${testPayload.group}"`);
                console.log(`  > Question: "${testPayload.question}"`);
                console.log(`  > Model:    ${testPayload.model}`);

                const result = await sendMessageAndMeasure(socket, testPayload, timeoutForThisQuestion);
                allResults.push(result);

                if (result.status === 'SUCCESS') {
                    console.log(`  > Status:   ✅ SUCCESS (${result.roundTripTime_ms}ms)`);
                    console.log(`  > Response: "${result.response?.substring(0, 150)}${result.response && result.response.length > 150 ? '...' : ''}"`);
                } else {
                    console.log(`  > Status:   ❌ ${result.status}`);
                    console.log(`  > Error:    ${result.error}`);
                }
                console.log('--------------------------------------------------');

                if (questionCounter < totalQuestionsToRun) {
                    console.log(`   ...waiting for ${CONFIG.QUESTION_INTERVAL_MS / 1000}s...`);
                    await sleep(CONFIG.QUESTION_INTERVAL_MS);
                }
            }
        }

        console.log('\n\n📊 ================== Test Summary ================== 📊');

        const successfulTests = allResults.filter(r => r.status === 'SUCCESS');
        console.log(`\n- Total successful requests: ${successfulTests.length}/${allResults.length}`);

        // --- Phân loại kết quả theo Group ---
        const resultsByGroup: { [key: string]: TestResult[] } = {};
        allResults.forEach(r => {
            const groupKey = r.payload.group || 'Ungrouped';
            if (!resultsByGroup[groupKey]) {
                resultsByGroup[groupKey] = [];
            }
            resultsByGroup[groupKey].push(r);
        });

        console.log('\n--- Results by Group ---');
        for (const groupName in resultsByGroup) {
            const groupResults = resultsByGroup[groupName];
            const successfulGroupResults = groupResults.filter(r => r.status === 'SUCCESS');
            let avgTimeText = 'N/A';
            if (successfulGroupResults.length > 0) {
                const avgTime = successfulGroupResults.reduce((sum, r) => sum + r.roundTripTime_ms!, 0) / successfulGroupResults.length;
                avgTimeText = `${avgTime.toFixed(2)}ms`;
            }
            console.log(`  - ${groupName.padEnd(20)}: ${successfulGroupResults.length}/${groupResults.length} successful | Avg Time: ${avgTimeText}`);
        }

        // --- Phân loại kết quả theo Model ---
        const resultsByModel: { [key: string]: TestResult[] } = {};
        allResults.forEach(r => {
            const modelKey = r.payload.model || 'default';
            if (!resultsByModel[modelKey]) {
                resultsByModel[modelKey] = [];
            }
            resultsByModel[modelKey].push(r);
        });

        console.log('\n--- Results by Model ---');
        for (const modelName in resultsByModel) {
            console.log(`\n  Model: ${modelName}`);
            const modelResults = resultsByModel[modelName];
            const successfulModelResults = modelResults.filter(r => r.status === 'SUCCESS');
            console.log(`  - Requests: ${successfulModelResults.length}/${modelResults.length} successful`);
            if (successfulModelResults.length > 0) {
                const avgTime = successfulModelResults.reduce((sum, r) => sum + r.roundTripTime_ms!, 0) / successfulModelResults.length;
                const maxTime = Math.max(...successfulModelResults.map(r => r.roundTripTime_ms!));
                const minTime = Math.min(...successfulModelResults.map(r => r.roundTripTime_ms!));
                console.log(`  - Avg Time: ${avgTime.toFixed(2)}ms`);
                console.log(`  - Min/Max Time: ${minTime}ms / ${maxTime}ms`);
            }
        }

        if (CONFIG.LOG_RESPONSES_TO_FILE) {
            try {
                const logDir = path.join(process.cwd(), 'chatbot_logs');
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }
                const logFilePath = path.join(logDir, CONFIG.LOG_FILE_NAME);
                fs.writeFileSync(logFilePath, JSON.stringify(allResults, null, 2));
                console.log(`\n\n📝 Full test results saved to: ${logFilePath}`);
            } catch (error) {
                console.error("\n❌ Failed to write log file:", error);
            }
        }

    } catch (error) {
        console.error('\nAn error occurred during the test execution. Aborting.', error);
    } finally {
        if (socket && socket.connected) {
            console.log('\n🔌 Disconnecting socket.');
            socket.disconnect();
        }
    }
}

runTests();