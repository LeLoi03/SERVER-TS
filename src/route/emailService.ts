// src/services/emailService.ts
import * as brevo from '@getbrevo/brevo'; // <<< Sử dụng import này nhất quán
import 'dotenv/config';

// --- Kiểm tra biến môi trường NGAY TỪ ĐẦU ---
if (!process.env.BREVO_API_KEY) {
    console.error("FATAL ERROR: BREVO_API_KEY is not defined in .env");
    // Quan trọng: Nên dừng ứng dụng hoặc throw lỗi ở đây nếu không có API key
    // process.exit(1); // Ví dụ: dừng hẳn nếu không có key
    throw new Error("BREVO_API_KEY is missing in environment variables.");
}
if (!process.env.EMAIL_FROM_ADDRESS) {
    console.warn("WARN: EMAIL_FROM_ADDRESS is not defined in .env. Using default.");
}
if (!process.env.EMAIL_FROM_NAME) {
    console.warn("WARN: EMAIL_FROM_NAME is not defined in .env. Using default.");
}

// --- Cấu hình Brevo Client MỘT LẦN ---
const apiInstance = new brevo.TransactionalEmailsApi();

// Sử dụng phương thức công khai setApiKey để đặt khóa API
// Đối số đầu tiên là chỉ số hoặc định danh của phương thức xác thực.
// Thường 'apiKey' là mặc định và có thể tham chiếu qua enum nếu có.
// Trong SDK này, bạn có thể dùng enum TransactionalEmailsApiApiKeys.apiKey
apiInstance.setApiKey(
    brevo.TransactionalEmailsApiApiKeys.apiKey, // <<< Sử dụng enum để chỉ định loại key
    process.env.BREVO_API_KEY! // <<< Lấy key từ .env (dấu ! khẳng định non-null vì đã check ở trên)
);

// --- Lấy thông tin người gửi từ .env hoặc dùng giá trị mặc định ---
const senderEmail = process.env.EMAIL_FROM_ADDRESS || "default-sender@example.com";
const senderName = process.env.EMAIL_FROM_NAME || "Default App";


/**
 * Gửi email xác thực tài khoản
 * @param toEmail Địa chỉ email người nhận
 * @param firstName Tên người nhận (để cá nhân hóa)
 * @param verificationCode Mã xác thực
 */
export const sendVerificationEmail = async (toEmail: string, firstName: string, verificationCode: string): Promise<void> => {
    // Tạo đối tượng SendSmtpEmail bên trong hàm để mỗi lần gọi là một email mới
    const sendSmtpEmail = new brevo.SendSmtpEmail(); // <<< Sử dụng brevo import

    sendSmtpEmail.subject = "Verify Your Account - Your App Name"; // <<< Thay đổi Subject nếu cần
    sendSmtpEmail.htmlContent = `
        <html>
            <body>
                <h1>Welcome to Your App Name, ${firstName}!</h1>
                <p>Thank you for registering. Please use the following code to verify your email address:</p>
                <p style="font-size: 24px; font-weight: bold; letter-spacing: 2px; margin: 20px 0; padding: 10px; background-color: #f0f0f0; display: inline-block;">
                    ${verificationCode}
                </p>
                <p>This code will expire in 15 minutes.</p>
                <p>If you did not request this registration, please ignore this email.</p>
                <br/>
                <p>Thanks,</p>
                <p>The Your App Name Team</p>
            </body>
        </html>
    `; // <<< Tùy chỉnh nội dung HTML
    sendSmtpEmail.sender = { name: senderName, email: senderEmail };
    sendSmtpEmail.to = [{ email: toEmail, name: firstName }];
    // sendSmtpEmail.cc = [{ email: "example2@example2.com", name: "Janice Doe" }];
    // sendSmtpEmail.bcc = [{ email: "example3@example2.com", name: "John Doe" }];
    // sendSmtpEmail.replyTo = { email: "replyto@domain.com", name: "Reply Name" };
    // sendSmtpEmail.headers = {"Some-Custom-Name": "unique-id-1234"};
    // sendSmtpEmail.params = {"parameter": "My param value", "subject": "New Subject"};

    try {
        // Sử dụng apiInstance đã được cấu hình ở trên
        const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
        // Log data trả về từ Brevo có thể hữu ích khi debug
        console.log('Verification Email sent successfully. Brevo Response:', data);
    } catch (error: any) {
        // Log chi tiết lỗi từ Brevo nếu có
        console.error('Error sending verification email via Brevo:');
        if (error.response) {
            // Lỗi từ API Brevo (có response body)
            console.error('Status:', error.response.status);
            console.error('Body:', error.response.body || error.response.text); // Log body hoặc text
        } else {
            // Lỗi mạng hoặc lỗi khác
            console.error('Error Message:', error.message);
        }
        // Ném lỗi để controller biết việc gửi mail thất bại và xử lý phù hợp
        throw new Error('Failed to send verification email.');
    }
};

// --- Có thể thêm các hàm gửi email khác ở đây (ví dụ: quên mật khẩu) ---
// Ví dụ: export const sendPasswordResetEmail = async (...) => { ... }