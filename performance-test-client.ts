// performance-test-client.ts
import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs'; // <<< THÊM MỚI: Để ghi log ra file
import * as path from 'path'; // <<< THÊM MỚI

// ========================================================================
// ---                          CẤU HÌNH TEST                          ---
// ========================================================================

const CONFIG = {
    SERVER_URL: 'http://localhost:3001',
    SOCKET_PATH: '/socket.io/',
    JWT_TOKEN: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJwYXlsb2FkIjp7ImlkIjoiOGQ0ODFmMTctZjBlMS00NDY1LWE4ZTEtMWQ2MTM2YTk3NzViIiwiZW1haWwiOiJmYW5uZWlob3VuYWZ1LTgwNDVAeW9wbWFpbC5jb20iLCJyb2xlIjoidXNlciJ9LCJpYXQiOjE3NTIxMDk0MTAsImV4cCI6MTc1MjEzMTAxMH0.e3FCbM3ftlOpmpGoDMluNsVFaOZfqDqJ2DOLrApyPdQ',
    DEFAULT_TEST_TIMEOUT_MS: 30000,
    FIRST_QUESTION_TIMEOUT_MS: 60000,
    // <<< THÊM MỚI: Tùy chọn ghi log câu trả lời ra file >>>
    LOG_RESPONSES_TO_FILE: true,
    LOG_FILE_NAME: `test-results-${new Date().toISOString().replace(/:/g, '-')}.json`
};


// ========================================================================
// ---                       DANH SÁCH CÂU HỎI TEST                     ---
// ========================================================================

// Mỗi phần tử có thể là một chuỗi, hoặc một object { question: string, model?: string }
const TEST_PAYLOADS = [
    // Câu hỏi 1: 
    {
        question: "Hello",
        model: "gemini-2.0-flash" // <<< CHO PHÉP CHỈ ĐỊNH MODEL
    },
    // Câu hỏi 2: 
    {
        question: "What things you can do?",
        model: "gemini-2.0-flash" // <<< CHO PHÉP CHỈ ĐỊNH MODEL
    },

    // Câu hỏi 3: 
    {
        question: "Find conference with Rank B in Vietnam",
        model: "gemini-2.5-flash-lite-preview-06-17"
    },


];

// ========================================================================

interface TestPayload {
    question: string;
    model?: string;
}

interface TestResult {
    frontendMessageId: string; // <<< THÊM MỚI
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
        // Lắng nghe các sự kiện lỗi để reject promise
        socket.on('connect_error', (err) => {
            console.error(`❌ Connection failed: ${err.message}`);
            socket.off(); // Gỡ bỏ tất cả listener để tránh memory leak
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

        // <<< SỬA ĐỔI QUAN TRỌNG >>>
        // Chỉ resolve promise KHI server báo đã sẵn sàng
        socket.on('connection_ready', (data) => {
            console.log(`✅ Server is ready! UserID: ${data.userId}`);
            // Gỡ bỏ các listener lỗi không cần thiết sau khi đã kết nối thành công
            socket.off('connect_error');
            socket.off('auth_error');
            socket.off('server_error');
            resolve(socket);
        });

        // Vẫn giữ listener 'connect' để log, nhưng nó không còn quyết định việc "sẵn sàng" nữa
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
            // Khi resolve, hãy thêm frontendMessageId vào kết quả
            resolve({
                frontendMessageId, // <<< THÊM MỚI
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
            // Khi resolve, hãy thêm frontendMessageId vào kết quả
            resolve({
                frontendMessageId, // <<< THÊM MỚI
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
            // Khi resolve, hãy thêm frontendMessageId vào kết quả
            resolve({
                frontendMessageId, // <<< THÊM MỚI
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

        // <<< SỬA ĐỔI QUAN TRỌNG: Xây dựng payload gửi đi >>>
        const messageData = {
            parts: [{ text: payload.question }],
            isStreaming: true,
            language: 'en',
            frontendMessageId,
            // Chỉ thêm trường 'model' nếu nó được định nghĩa trong payload
            ...(payload.model && { model: payload.model }),
        };

        console.log(`\n   -> Sending payload:`, messageData);
        socket.emit('send_message', messageData);
    });
}

async function runTests() {
    let socket: Socket | null = null;
    try {
        socket = await connectToServer();
        const allResults: TestResult[] = [];

        console.log(`\n🚀 Starting performance test with ${TEST_PAYLOADS.length} questions...`);
        console.log('--------------------------------------------------');

        for (let i = 0; i < TEST_PAYLOADS.length; i++) {
            const rawPayload = TEST_PAYLOADS[i];
            const testPayload: TestPayload = typeof rawPayload === 'string'
                ? { question: rawPayload }
                : rawPayload;

            const timeoutForThisQuestion = (i === 0)
                ? CONFIG.FIRST_QUESTION_TIMEOUT_MS
                : CONFIG.DEFAULT_TEST_TIMEOUT_MS;

            // <<< SỬA ĐỔI: In câu hỏi và model rõ ràng hơn >>>
            console.log(`\n[${i + 1}/${TEST_PAYLOADS.length}] Testing...`);
            console.log(`  > Question: "${testPayload.question}"`);
            console.log(`  > Model: ${testPayload.model || 'default'}`);

            const result = await sendMessageAndMeasure(socket, testPayload, timeoutForThisQuestion);
            allResults.push(result);

            // <<< SỬA ĐỔI: In kết quả và câu trả lời >>>
            if (result.status === 'SUCCESS') {
                console.log(`  > Status: ✅ SUCCESS (${result.roundTripTime_ms}ms)`);
                console.log(`  > Response: "${result.response?.substring(0, 150)}${result.response && result.response.length > 150 ? '...' : ''}"`);
            } else {
                console.log(`  > Status: ❌ ${result.status}`);
                console.log(`  > Error: ${result.error}`);
            }
            console.log('--------------------------------------------------');
        }

        console.log('📊 Test Summary:');

        const successfulTests = allResults.filter(r => r.status === 'SUCCESS');
        console.log(`- Total successful requests: ${successfulTests.length}/${allResults.length}`);

        const resultsByModel: { [key: string]: TestResult[] } = {};
        allResults.forEach(r => {
            const modelKey = r.payload.model || 'default';
            if (!resultsByModel[modelKey]) {
                resultsByModel[modelKey] = [];
            }
            resultsByModel[modelKey].push(r);
        });

        for (const modelName in resultsByModel) {
            const modelResults = resultsByModel[modelName];
            const successfulModelResults = modelResults.filter(r => r.status === 'SUCCESS');
            console.log(`\n  Model: ${modelName}`);
            console.log(`  - Requests: ${successfulModelResults.length}/${modelResults.length} successful`);
            if (successfulModelResults.length > 0) {
                const avgTime = successfulModelResults.reduce((sum, r) => sum + r.roundTripTime_ms!, 0) / successfulModelResults.length;
                const maxTime = Math.max(...successfulModelResults.map(r => r.roundTripTime_ms!));
                const minTime = Math.min(...successfulModelResults.map(r => r.roundTripTime_ms!));
                console.log(`  - Avg Time: ${avgTime.toFixed(2)}ms`);
                console.log(`  - Min/Max Time: ${minTime}ms / ${maxTime}ms`);
            }
        }

        // <<< THÊM MỚI: Ghi kết quả chi tiết ra file JSON >>>
        if (CONFIG.LOG_RESPONSES_TO_FILE) {
            try {
                const logDir = path.join(process.cwd(), 'chatbot_logs');
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir);
                }
                const logFilePath = path.join(logDir, CONFIG.LOG_FILE_NAME);
                fs.writeFileSync(logFilePath, JSON.stringify(allResults, null, 2));
                console.log(`\n📝 Full test results saved to: ${logFilePath}`);
            } catch (error) {
                console.error("\n❌ Failed to write log file:", error);
            }
        }

    } catch (error) {
        console.error('\nAn error occurred during the test execution. Aborting.');
    } finally {
        if (socket) {
            socket.disconnect();
        }
    }
}

runTests();
