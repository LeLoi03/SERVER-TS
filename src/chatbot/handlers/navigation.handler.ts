// src/handlers/navigation.handler.ts
import { IFunctionHandler } from '../interface/functionHandler.interface'; // Adjust path if needed
import { FunctionHandlerInput, FunctionHandlerOutput, StatusUpdate } from '../shared/types'; // Adjust path if needed
import logToFile from '../../utils/logger'; // Adjust path if needed

export class NavigationHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, handlerId, socketId, onStatusUpdate } = context;
        // Sử dụng optional chaining (?) để lấy url an toàn hơn
        const targetUrl = args?.url as string | undefined;
        const logPrefix = `[${handlerId} ${socketId}]`; // Tiền tố log dùng chung

        logToFile(`${logPrefix} Handler: Navigation, Args: ${JSON.stringify(args)}`);

        // --- Helper function để gửi status update ---
        // Giúp giảm lặp code và kiểm tra onStatusUpdate chỉ một lần
        const sendStatus = (step: string, message: string, details?: object) => {
            if (onStatusUpdate) {
                onStatusUpdate('status_update', {
                    type: 'status',
                    step,
                    message,
                    details, // Thêm details nếu có
                    timestamp: new Date().toISOString(),
                });
            } else {
                logToFile(`${logPrefix} Warning: onStatusUpdate not provided for step: ${step}`);
            }
        };

        try {
            // 1. Validation
            sendStatus('validating_navigation_url', 'Validating navigation URL argument...', { args });

            const isValidUrl = targetUrl &&
                               typeof targetUrl === 'string' &&
                               (targetUrl.startsWith('/') || targetUrl.startsWith('http://') || targetUrl.startsWith('https://'));

            // Sử dụng Guard Clause: Xử lý trường hợp lỗi trước và return sớm
            if (!isValidUrl) {
                const errorMsg = "Invalid or missing 'url' argument. URL must start with '/' or 'http(s)://'.";
                logToFile(`${logPrefix} Navigation: Invalid or missing 'url': ${targetUrl}`);
                sendStatus('function_error', 'Invalid navigation URL provided.', { error: errorMsg, url: targetUrl });
                return {
                    modelResponseContent: `Error: ${errorMsg} Received: "${targetUrl || 'undefined'}"`, // Hiển thị rõ hơn nếu url là undefined
                    frontendAction: undefined,
                };
            }

            // --- Nếu validation thành công ---
            logToFile(`${logPrefix} Navigation: Valid target URL: ${targetUrl}`);

            // 2. Prepare Action
            sendStatus('navigation_action_prepared', 'Navigation action prepared.', { url: targetUrl });

            // Trả về kết quả thành công
            return {
                modelResponseContent: `Navigation action acknowledged. The user will be directed to the requested page (${targetUrl}).`,
                // targetUrl chắc chắn là string ở đây do đã qua validation
                frontendAction: { type: 'navigate', url: targetUrl },
            };

        } catch (error: any) {
            // Xử lý lỗi chung
            const errorMessage = error instanceof Error ? error.message : String(error);
            logToFile(`${logPrefix} Error in NavigationHandler: ${errorMessage}`);
            // Sử dụng helper sendStatus
            sendStatus('function_error', `Error during navigation processing: ${errorMessage}`);
            return {
                modelResponseContent: `Error executing navigation: ${errorMessage}`,
                frontendAction: undefined
            };
        }
    }
}