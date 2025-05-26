


// // const internalPaths = [
// //     '/',
// //     '/conferences',
// //     '/dashboard',
// //     '/journals',
// //     '/chatbot',
// //     '/visualization',
// //     '/chatbot/chat',
// //     '/chatbot/livechat',
// //     '/support',
// //     '/other',
// //     '/addconference',
// //     // '/conferences/detail', 
// //     // '/journals/detail',    
// //     '/auth/login',
// //     '/auth/register',
// //     '/auth/verify-email',
// //     '/auth/forgot-password',
// //     '/auth/reset-password',
// //     // '/updateconference'
// // ];




// // Vietnamese
// export const vietnameseRouteToAgentDeclaration: FunctionDeclaration = {
//     name: "routeToAgent",
//     description: "Chuyển một nhiệm vụ cụ thể đến một agent chuyên biệt được chỉ định.",
//     parameters: {
//         type: SchemaType.OBJECT,
//         properties: {
//             targetAgent: {
//                 type: SchemaType.STRING,
//                 description: "Định danh duy nhất của agent chuyên biệt để chuyển nhiệm vụ đến (ví dụ: 'ConferenceAgent').",
//             },
//             taskDescription: {
//                 type: SchemaType.STRING,
//                 description: "Mô tả chi tiết bằng ngôn ngữ tự nhiên về nhiệm vụ cho agent mục tiêu.",
//             }
//         },
//         required: ["targetAgent", "taskDescription"],
//     },
// };

// // export const vietnameseGetConferencesDeclaration: FunctionDeclaration = {
// //     name: "getConferences",
// //     // Mô tả rõ mục đích là tạo query string
// //     description: "Tạo một chuỗi truy vấn được mã hóa URL để tìm kiếm các hội nghị dựa trên tiêu chí do người dùng chỉ định. Chuỗi truy vấn này sẽ được sử dụng để lấy dữ liệu từ API backend." +
// //         " Điều quan trọng là *tất cả* các giá trị trong chuỗi truy vấn phải được mã hóa URL đúng cách để đảm bảo API backend diễn giải tiêu chí tìm kiếm chính xác. Việc không mã hóa giá trị đúng cách có thể dẫn đến kết quả tìm kiếm sai hoặc lỗi." +
// //         " Lưu ý về độ dài tối đa của URL, vì các chuỗi truy vấn quá dài có thể bị cắt bớt bởi trình duyệt hoặc máy chủ. Cân nhắc giới hạn số lượng tham số `topics` hoặc `researchFields` nếu cần." +
// //         " API backend có thể phân biệt chữ hoa/thường đối với một số tham số (ví dụ: `country`, `continent`). Đảm bảo cách viết hoa/thường của các giá trị khớp với định dạng mong đợi." +
// //         " Một ví dụ toàn diện kết hợp nhiều tiêu chí: `title=International+Conference+on+AI&topics=AI&topics=Machine+Learning&country=USA&fromDate=2024-01-01&toDate=2024-12-31&rank=A*`",
// //     parameters: {
// //         type: SchemaType.OBJECT, // Vẫn là OBJECT theo cấu trúc chung
// //         properties: {
// //             // Định nghĩa một tham số duy nhất để chứa query string
// //             searchQuery: {
// //                 type: SchemaType.STRING,
// //                 // Hướng dẫn chi tiết cách tạo query string (bằng Tiếng Anh)
// //                 description: "A URL-encoded query string constructed from the user's search criteria for conferences. Format as key=value pairs separated by '&'. " +
// //                     "Available keys based on potential user queries include: " +
// //                     "`title` (string):  The full, formal name of the conference.(e.g., International Conference on Management of Digital EcoSystems) " +
// //                     "`acronym` (string): The abbreviated name of the conference, often represented by capital letters (e.g., ICCCI, SIGGRAPH, ABZ). " +
// //                     "`fromDate` (string, e.g., YYYY-MM-DD), " +
// //                     "`toDate` (string, e.g., YYYY-MM-DD), " +
// //                     "`topics` (string, repeat key for multiple values, e.g., topics=AI&topics=ML), " +
// //                     "`cityStateProvince` (string), " +
// //                     "`country` (string), " +
// //                     "`continent` (string), " +
// //                     "`address` (string), " +
// //                     "`researchFields` (string, repeat key for multiple values), " +
// //                     "`rank` (string), " +
// //                     "`source` (string), " +
// //                     "`accessType` (string), " +
// //                     "`keyword` (string), " +
// //                     "`subFromDate` (string), `subToDate` (string), " +
// //                     "`cameraReadyFromDate` (string), `cameraReadyToDate` (string), " +
// //                     "`notificationFromDate` (string), `notificationToDate` (string), " +
// //                     "`registrationFromDate` (string), `registrationToDate` (string), " +
// //                     "`mode` (string): If the user requests detailed information, the value is always `detail`. " +
// //                     "`perPage` (number):  The number of conferences to return per page. If the user specifies a number, use that value. If the user doesn't specify a number, default to 5." +
// //                     "`page` (number):  The page number of the results to return. If the user wants to see the next set of conferences, use page=2, page=3, etc. If the user doesn't specify a page number, default to 1." +
// //                     "Ensure all values are properly URL-encoded (e.g., spaces become + or +). " +

// //                     "**Distinguishing between Title and Acronym:** It is crucial to correctly identify whether the user is providing the full conference title or the acronym.  Here's how to differentiate them:" +
// //                     "* **Title:** This is the complete, unabbreviated name of the conference.  It is typically a phrase or sentence that describes the conference's focus. Example: 'International Conference on Machine Learning'.  Use the `title` parameter for this." +
// //                     "* **Acronym:** This is a short, usually capitalized, abbreviation of the conference name. Example: 'ICML' (for International Conference on Machine Learning).  Use the `acronym` parameter for this." +

// //                     "**Examples:**" +
// //                     "* User query: 'Find conferences about ICML'.  `searchQuery=acronym=ICML&perPage=5&page=1` (Default perPage and page)" +
// //                     "* User query: 'Search for the International Conference on Management of Digital EcoSystems'. `searchQuery=title=International+Conference+on+Management+of+Digital+EcoSystems&perPage=5&page=1` (Default perPage and page)" +
// //                     "* User query: 'Find MEDES conferences'. `searchQuery=acronym=MEDES&perPage=5&page=1` (Default perPage and page)" +
// //                     "* User query: 'Search for conferences with the full name International Conference on Recent Trends in Image Processing, Pattern Recognition and Machine Learning'. `searchQuery=title=International+Conference+on+Recent+Trends+in+Image+Processing,+Pattern+Recognition+and+Machine+Learning&perPage=5&page=1` (Default perPage and page)" +
// //                     "* User query 1: 'Find 3 conferences in USA'. `searchQuery=country=USA&perPage=3&page=1` User query 2: 'Find 5 different conferences in USA'. `searchQuery=country=USA&perPage=5&page=2`" +

// //                     "For example, if a topic contains both spaces and special characters, like 'Data Science & Analysis', it should be encoded as 'Data+Science+&+Analysis'. " +
// //                     "If a user doesn't specify a value for a particular key, it should be omitted entirely from the query string.  Do not include keys with empty values (e.g., `title=`). " +
// //                     "To specify multiple topics or research fields, repeat the key for each value. For example: `topics=AI&topics=Machine+Learning&researchFields=Computer+Vision&researchFields=Natural+Language+Processing`. " +
// //                     "Always URL-encode special characters in values. For example, use `+` for spaces, `&` for ampersands, `=` for equals signs, and `+` for plus signs. " +
// //                     "To search for conferences between two dates, use `fromDate` and `toDate`. For example, to search for conferences happening between January 1, 2023, and December 31, 2023, use `fromDate=2023-01-01&toDate=2023-12-31`. " +
// //                     "If the user requests *detailed* information about the conferences (e.g., details information, full descriptions, specific dates, call for papers, summary, etc.), add the parameter `mode=detail` in beginning of the query string."
// //             }
// //         },
// //         // Đảm bảo Gemini luôn cung cấp tham số này
// //         required: ["searchQuery"]
// //     }
// // };

// // export const vietnamGetJournalsDeclaration: FunctionDeclaration = {
// //     name: "getJournals",
// //     description: "Truy xuất thông tin về các tạp chí dựa trên tiêu chí lọc.",
// //     parameters: {
// //         type: SchemaType.OBJECT,
// //         properties: {
// //             "Rank": {
// //                 "type": SchemaType.ARRAY,
// //                 "description": "Danh sách các hạng tạp chí để lọc theo.",
// //                 "items": {
// //                     "type": SchemaType.NUMBER
// //                 }
// //             },
// //             "Title": {
// //                 "type": SchemaType.ARRAY,
// //                 "description": "Danh sách các tiêu đề tạp chí để lọc theo.",
// //                 "items": {
// //                     "type": SchemaType.STRING
// //                 }
// //             },
// //             "Issn": {
// //                 "type": SchemaType.ARRAY,
// //                 "description": "Danh sách các mã ISSN của tạp chí để lọc theo.",
// //                 "items": {
// //                     "type": SchemaType.STRING
// //                 }
// //             },
// //             "SJR": {
// //                 "type": SchemaType.ARRAY,
// //                 "description": "Danh sách các giá trị SJR của tạp chí để lọc theo.",
// //                 "items": {
// //                     "type": SchemaType.NUMBER
// //                 }
// //             },
// //             "SJRBestQuartile": {
// //                 "type": SchemaType.ARRAY,
// //                 "description": "Danh sách các giá trị Phân vị Tốt nhất SJR (SJR Best Quartile) của tạp chí để lọc theo.",
// //                 "items": {
// //                     "type": SchemaType.STRING // Có thể là Q1, Q2, Q3, Q4
// //                 }
// //             },
// //             "HIndex": {
// //                 "type": SchemaType.INTEGER,
// //                 "description": "Chỉ số H (H index) của tạp chí để lọc theo."
// //             },
// //             "Country": {
// //                 "type": SchemaType.ARRAY,
// //                 "description": "Danh sách các quốc gia để lọc tạp chí theo.",
// //                 "items": {
// //                     "type": SchemaType.STRING
// //                 }
// //             },
// //             "Region": {
// //                 "type": SchemaType.ARRAY,
// //                 "description": "Danh sách các khu vực để lọc tạp chí theo.",
// //                 "items": {
// //                     "type": SchemaType.STRING
// //                 }
// //             },
// //             "Publisher": {
// //                 "type": SchemaType.ARRAY,
// //                 "description": "Danh sách các nhà xuất bản để lọc tạp chí theo.",
// //                 "items": {
// //                     "type": SchemaType.STRING
// //                 }
// //             },
// //             "Areas": {
// //                 "type": SchemaType.ARRAY,
// //                 "description": "Danh sách các lĩnh vực (areas) để lọc tạp chí theo.",
// //                 "items": {
// //                     "type": SchemaType.STRING
// //                 }
// //             },
// //             "Categories": {
// //                 "type": SchemaType.ARRAY,
// //                 "description": "Danh sách các danh mục (categories) để lọc tạp chí theo.",
// //                 "items": {
// //                     "type": SchemaType.STRING
// //                 }
// //             },
// //             "Overton": {
// //                 "type": SchemaType.ARRAY,
// //                 "description": "Danh sách các giá trị Overton để lọc tạp chí theo.",
// //                 "items": {
// //                     "type": SchemaType.NUMBER
// //                 }
// //             },
// //             "SDG": {
// //                 "type": SchemaType.ARRAY,
// //                 "description": "Danh sách các Mục tiêu Phát triển Bền vững (SDGs) để lọc tạp chí theo.",
// //                 "items": {
// //                     "type": SchemaType.STRING // Thường là số hoặc mã của SDG
// //                 }
// //             }
// //         }
// //     },
// // };

// // export const vietnamGetWebsiteInfoDeclaration: FunctionDeclaration = {
// //     name: "getWebsiteInfo",
// //     description: "Truy xuất thông tin về trang web. Hàm này không cần tham số, chỉ cần gọi nó."
// // };

// // export const vietnamDrawChartDeclaration: FunctionDeclaration = {
// //     name: "drawChart",
// //     description: "Vẽ biểu đồ dựa trên dữ liệu được cung cấp.",
// //     parameters: {
// //         type: SchemaType.OBJECT,
// //         properties: {
// //             chartType: {
// //                 type: SchemaType.STRING,
// //                 description: "Loại biểu đồ (ví dụ: bar (cột), line (đường), pie (tròn)).",
// //             }
// //         },
// //         required: ["chartType"],
// //     },
// // };

// // export const vietnameseNavigationDeclaration: FunctionDeclaration = {
// //     name: "navigation",
// //     description: `Điều hướng người dùng đến một trang cụ thể trong trang web này hoặc đến một trang web hội nghị/tạp chí bên ngoài bằng cách mở một tab trình duyệt mới.
// //     - Đối với điều hướng NỘI BỘ: Cung cấp đường dẫn tương đối bắt đầu bằng '/'. Hệ thống sẽ tự động thêm URL gốc và ngôn ngữ (locale). Các đường dẫn nội bộ được phép là: ${internalPaths.join(', ')}. Ví dụ: {"url": "/conferences"}
// //     - Đối với các trang hội nghị/tạp chí BÊN NGOÀI: Cung cấp URL đầy đủ, hợp lệ bắt đầu bằng 'http://' hoặc 'https://'.`,
// //     parameters: {
// //         type: SchemaType.OBJECT, // Kiểu SchemaType.OBJECT
// //         properties: { // Thuộc tính
// //             url: {
// //                 type: SchemaType.STRING, // Kiểu SchemaType.STRING
// //                 description: `Đường dẫn nội bộ (bắt đầu bằng '/', ví dụ: '/dashboard') hoặc URL đầy đủ bên ngoài (bắt đầu bằng 'http://' hoặc 'https://', ví dụ: 'https://some-journal.com/article') để điều hướng đến.`
// //             }
// //         },
// //         required: ["url"] // Bắt buộc
// //     }
// // };

// // export const vietnameseOpenGoogleMapDeclaration: FunctionDeclaration = {
// //     name: "openGoogleMap",
// //     description: "Mở Google Maps trong một tab trình duyệt mới, hướng đến một chuỗi địa điểm cụ thể (ví dụ: thành phố, địa chỉ, địa danh).",
// //     parameters: {
// //         type: SchemaType.OBJECT, // Kiểu SchemaType.OBJECT
// //         properties: { // Thuộc tính
// //             location: {
// //                 type: SchemaType.STRING, // Kiểu SchemaType.STRING
// //                 description: "Chuỗi địa điểm địa lý để tìm kiếm trên Google Maps (ví dụ: 'Delphi, Hy Lạp', 'Tháp Eiffel, Paris', '1600 Amphitheatre Parkway, Mountain View, CA').",
// //             },
// //         },
// //         required: ["location"], // Bắt buộc
// //     },
// // };

// // export const vietnameseManageFollowDeclaration: FunctionDeclaration = {
// //     name: "manageFollow",
// //     description: "Theo dõi hoặc bỏ theo dõi một hội nghị hoặc tạp chí cụ thể cho người dùng đang đăng nhập.",
// //     parameters: {
// //         type: SchemaType.OBJECT, // Kiểu SchemaType.OBJECT
// //         properties: { // Thuộc tính
// //             itemType: {
// //                 type: SchemaType.STRING, // Kiểu SchemaType.STRING
// //                 description: "Loại của mục.",
// //                 enum: ["conference", "journal"] // Giá trị được phép
// //             },
// //             identifier: {
// //                 type: SchemaType.STRING, // Kiểu SchemaType.STRING
// //                 description: "Một định danh duy nhất cho mục, chẳng hạn như từ viết tắt hoặc tiêu đề chính xác của nó, đã được truy xuất trước đó.",
// //             },
// //             identifierType: {
// //                  type: SchemaType.STRING, // Kiểu SchemaType.STRING
// //                  description: "Loại định danh được cung cấp.",
// //                  enum: ["acronym", "title", "id"], // Cho phép Model chỉ định nếu biết loại
// //             },
// //             action: {
// //                 type: SchemaType.STRING, // Kiểu SchemaType.STRING
// //                 description: "Hành động mong muốn thực hiện.",
// //                 enum: ["follow", "unfollow"] // Giá trị được phép
// //             },
// //         },
// //         required: ["itemType", "identifier", "identifierType", "action"], // Bắt buộc
// //     },
// // };

// // export const vietnameseSendEmailToAdminDeclaration: FunctionDeclaration = {
// //     name: "sendEmailToAdmin",
// //     description: "Gửi một email đến quản trị viên trang web thay mặt cho người dùng. Sử dụng chức năng này khi người dùng muốn liên hệ rõ ràng với quản trị viên, báo cáo sự cố, cung cấp phản hồi, hoặc yêu cầu trợ giúp cụ thể cần sự can thiệp của quản trị viên. Bạn nên giúp người dùng soạn thảo chủ đề, nội dung thư và xác nhận loại yêu cầu ('contact' hoặc 'report') trước khi gọi hàm này.",
// //     parameters: {
// //         type: SchemaType.OBJECT, // Kiểu SchemaType.OBJECT
// //         properties: { // Thuộc tính
// //             subject: {
// //                 type: SchemaType.STRING, // Kiểu SchemaType.STRING
// //                 description: "Dòng chủ đề cho email gửi đến quản trị viên. Nên ngắn gọn và phản ánh mục đích của email.",
// //             },
// //             requestType: {
// //                 type: SchemaType.STRING, // Kiểu SchemaType.STRING
// //                 description: "Loại yêu cầu. Sử dụng 'contact' cho các yêu cầu chung, phản hồi, hoặc yêu cầu liên hệ. Sử dụng 'report' để báo cáo sự cố, lỗi, hoặc vấn đề với trang web hoặc nội dung của nó.",
// //                 enum: ["contact", "report"], // Chỉ định các giá trị được phép
// //             },
// //             message: {
// //                 type: SchemaType.STRING, // Kiểu SchemaType.STRING
// //                 description: "Nội dung chính của thư email, trình bày chi tiết yêu cầu, báo cáo hoặc phản hồi của người dùng.",
// //             },
// //         },
// //         required: ["subject", "requestType", "message"], // Tất cả các trường là bắt buộc
// //     },
// // };