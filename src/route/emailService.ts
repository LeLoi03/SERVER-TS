// src/services/emailService.ts
import * as brevo from '@getbrevo/brevo'; // <<< Sử dụng import này nhất quán
import 'dotenv/config';
import { UserResponse } from '../types/user.response';
import { ConferenceResponse } from '../types/conference.response';


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



// --- NEW: Function to send Follow/Unfollow Notification Email ---

interface FollowNotificationEmailParams {
    recipientUser: UserResponse; // Who receives the email
    actingUser?: UserResponse; // Who performed the action (null if recipient is the actor)
    conference: ConferenceResponse;
    isFollowing: boolean; // True if follow, false if unfollow
    isRecipientTheActor: boolean; // True if the email is for the person who followed/unfollowed
}

export const sendFollowNotificationEmail = async (params: FollowNotificationEmailParams): Promise<void> => {
    const { recipientUser, actingUser, conference, isFollowing, isRecipientTheActor } = params;

    // --- Determine Subject and Content ---
    let subject = '';
    let htmlContent = '';
    const conferenceTitle = conference.conference.title;
    const recipientName = recipientUser.firstName || 'User';

    if (isRecipientTheActor) {
        // Email for the user who performed the action
        subject = isFollowing
            ? `You followed ${conferenceTitle}`
            : `You unfollowed ${conferenceTitle}`;
        htmlContent = `
            <html><body>
                <h1>Hi ${recipientName},</h1>
                <p>You have successfully ${isFollowing ? 'followed' : 'unfollowed'} the conference: <strong>${conferenceTitle}</strong>.</p>
                <p>You can manage your followed conferences in your profile.</p>
                <br/><p>Thanks,</p><p>The Your App Name Team</p>
            </body></html>
        `;
    } else if (actingUser) {
        // Email for other followers about someone else's action (only for follow)
        if (!isFollowing) return; // Typically don't notify others on unfollow

        const actorName = `${actingUser.firstName || ''} ${actingUser.lastName || ''}`.trim() || 'Someone';
        subject = `${actorName} followed ${conferenceTitle}`;
        htmlContent = `
            <html><body>
                <h1>Hi ${recipientName},</h1>
                <p><strong>${actorName}</strong> has just followed the conference: <strong>${conferenceTitle}</strong>, which you are also following.</p>
                <br/><p>Thanks,</p><p>The Your App Name Team</p>
            </body></html>
        `;
    } else {
        // Should not happen with current logic, but good to handle
        console.warn("sendFollowNotificationEmail called without sufficient context.");
        return;
    }

    // --- Prepare and Send Email ---
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = htmlContent;
    sendSmtpEmail.sender = { name: senderName, email: senderEmail };
    sendSmtpEmail.to = [{ email: recipientUser.email, name: recipientName }]; // Use recipient's details

    try {
        const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.log(`Follow/Unfollow Email sent successfully to ${recipientUser.email}. Brevo Response:`, JSON.stringify(data));
    } catch (error: any) {
        console.error(`Error sending follow/unfollow email to ${recipientUser.email} via Brevo:`);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Body:', error.response.body || error.response.text);
        } else {
            console.error('Error Message:', error.message);
        }
        // Log the error, but don't throw here to avoid stopping the main request
        // The calling function should be aware that email might fail.
    }
};


// --- NEW: Function to send Add/Remove Calendar Notification Email ---

interface CalendarNotificationEmailParams {
    recipientUser: UserResponse; // Who receives the email
    actingUser: UserResponse;   // Who performed the action
    conference: ConferenceResponse;
    isAdding: boolean; // True if adding, false if removing
    isRecipientTheActor: boolean; // True if the email is for the person who performed the action
}

export const sendCalendarNotificationEmail = async (params: CalendarNotificationEmailParams): Promise<void> => {
    const { recipientUser, actingUser, conference, isAdding, isRecipientTheActor } = params;

    // --- Determine Subject and Content ---
    let subject = '';
    let htmlContent = '';
    const conferenceTitle = conference.conference.title;
    const recipientName = recipientUser.firstName || 'User';
    const actionVerbPast = isAdding ? 'added' : 'removed';
    const actionVerbPresent = isAdding ? 'add' : 'remove';
    const preposition = isAdding ? 'to' : 'from';

    if (isRecipientTheActor) {
        // Email for the user who performed the action
        subject = `Conference ${actionVerbPast} ${preposition} your calendar: ${conferenceTitle}`;
        htmlContent = `
            <html><body>
                <h1>Hi ${recipientName},</h1>
                <p>You have successfully ${actionVerbPast} the conference <strong>"${conferenceTitle}"</strong> ${preposition} your calendar.</p>
                <p>You can view your calendar in your profile.</p>
                <br/><p>Thanks,</p><p>The Your App Name Team</p>
            </body></html>
        `;
    } else {
        // Email for other followers about someone else's action (only for 'add' currently)
        if (!isAdding) return; // Assuming we only notify others on 'add' as per original logic

        const actorName = `${actingUser.firstName || ''} ${actingUser.lastName || ''}`.trim() || 'Someone';
        subject = `${actorName} ${actionVerbPast} ${conferenceTitle} ${preposition} their calendar`;
        htmlContent = `
            <html><body>
                <h1>Hi ${recipientName},</h1>
                <p>Just letting you know, <strong>${actorName}</strong> has ${actionVerbPast} the conference <strong>"${conferenceTitle}"</strong> ${preposition} their calendar.</p>
                ${'' /* Optional: Add context like "which you are also following" if relevant */}
                <br/><p>Thanks,</p><p>The Your App Name Team</p>
            </body></html>
        `;
    }

    // --- Prepare and Send Email ---
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = htmlContent;
    sendSmtpEmail.sender = { name: senderName, email: senderEmail };
    sendSmtpEmail.to = [{ email: recipientUser.email, name: recipientName }];

    try {
        const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.log(`Calendar Action Email sent successfully to ${recipientUser.email}. Brevo Response:`, JSON.stringify(data));
    } catch (error: any) {
        console.error(`Error sending calendar action email to ${recipientUser.email} via Brevo:`);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Body:', error.response.body || error.response.text);
        } else {
            console.error('Error Message:', error.message);
        }
        // Log error, but don't throw to avoid stopping the main request
    }
};


// --- NEW: Function to send Blacklist/Unblacklist Notification Email ---

interface BlacklistNotificationEmailParams {
    recipientUser: UserResponse; // Who receives the email (always the actor)
    conferenceTitle: string;     // Title of the conference
    isBlacklisting: boolean;     // True if adding to blacklist, false if removing
}

export const sendBlacklistNotificationEmail = async (params: BlacklistNotificationEmailParams): Promise<void> => {
    const { recipientUser, conferenceTitle, isBlacklisting } = params;

    // --- Determine Subject and Content ---
    const actionVerbPast = isBlacklisting ? 'added' : 'removed';
    const preposition = isBlacklisting ? 'to' : 'from';
    const recipientName = recipientUser.firstName || 'User';

    const subject = `Conference ${actionVerbPast} ${preposition} your blacklist: ${conferenceTitle}`;
    const htmlContent = `
        <html><body>
            <h1>Hi ${recipientName},</h1>
            <p>You have successfully ${actionVerbPast} the conference <strong>"${conferenceTitle}"</strong> ${preposition} your blacklist.</p>
            <p>You can manage your blacklist settings in your profile.</p>
            <br/><p>Thanks,</p><p>The Your App Name Team</p>
        </body></html>
    `;

    // --- Prepare and Send Email ---
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = htmlContent;
    sendSmtpEmail.sender = { name: senderName, email: senderEmail };
    sendSmtpEmail.to = [{ email: recipientUser.email, name: recipientName }];

    try {
        const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.log(`Blacklist Action Email sent successfully to ${recipientUser.email}. Brevo Response:`, JSON.stringify(data));
    } catch (error: any) {
        console.error(`Error sending blacklist action email to ${recipientUser.email} via Brevo:`);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Body:', error.response.body || error.response.text);
        } else {
            console.error('Error Message:', error.message);
        }
        // Log error, but don't throw
    }
};