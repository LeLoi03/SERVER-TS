// src/chatbot/utils/historyMapper.ts
import { HistoryItem, ChatMessage } from '../shared/types'; // Đảm bảo Part được import nếu dùng trực tiếp
import { Part } from '@google/generative-ai';

export const mapHistoryToFrontendMessages = (history: HistoryItem[]): ChatMessage[] => {
    if (!history || !Array.isArray(history)) { // Thêm kiểm tra history là mảng
        console.warn('[historyMapper] mapHistoryToFrontendMessages received invalid history:', history);
        return [];
    }

    const filteredHistory = history.filter(item => {
        if (item.role === 'user' && item.parts?.some(part => 'text' in part && part.text)) {
            return true;
        }
        if (item.role === 'model' && item.parts?.some(part => 'text' in part && part.text)) {
            return true;
        }
        return false;
    });

    return filteredHistory.map((item): ChatMessage | null => { // Có thể trả về null nếu item không hợp lệ
        // Lấy text từ part đầu tiên có text
        const textPart = item.parts?.find(part => 'text' in part && typeof (part as Part & { text: string }).text === 'string') as Part & { text: string } | undefined;

        if (!textPart || !item.uuid) { // Nếu không có text hoặc không có uuid, bỏ qua hoặc log lỗi
            console.warn('[historyMapper] Invalid item in history - missing text or uuid:', item);
            return null; // Hoặc xử lý khác tùy theo yêu cầu
        }
        const messageText = textPart.text;

        // Xác định type cơ bản
        const messageType: ChatMessage['type'] = 'text'; // Sử dụng ChatMessage['type'] để đồng bộ

        return {
            id: item.uuid, // <<<<<<<<<<<<<<<<<<< SỬA Ở ĐÂY: Dùng UUID gốc từ item
            message: messageText,
            isUser: item.role === 'user',
            type: messageType,
            thoughts: undefined,
            location: undefined,
            timestamp: item.timestamp || new Date().toISOString(), // Thêm timestamp nếu có và cần thiết
            // action, errorCode, etc. nếu có
        };
    }).filter(Boolean) as ChatMessage[]; // Lọc ra các giá trị null và ép kiểu lại
};