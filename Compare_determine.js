import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv'; // Cài đặt thư viện dotenv để quản lý API Key một cách an toàn

dotenv.config(); // Load các biến môi trường từ file .env

// Lấy API Key từ biến môi trường (an toàn hơn so với đặt trực tiếp trong code)
const API_KEY = "AIzaSyDK5eYs2PBVYP3l9UH0YMIFshxBMq6EsE8";
if (!API_KEY) {
  console.error("Lỗi: GOOGLE_API_KEY không được đặt trong file .env");
  process.exit(1);
}

async function run() {
  try {
    // Khởi tạo Generative Model
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: "tunedModels/extractinforedit100-gngylj3g8qz3" }); // Sử dụng model "gemini-pro" hoặc các model khác có sẵn

    // Định nghĩa nội dung cho request
    const prompt = `
    Conference full name: ACIS Conference on Software Engineering Research, Management and Applications (SERA)

1. Website of SERA_0: https://acisinternational.org/conferences/sera-2025/
Website information of SERA_0:

Home | ACIS News 
 Contact Us 
 About 
 Membership 
 Conference Calendar | href="https://acisinternational.org/conferences/bcd-2024-winter/" - BCD 2025-Winter 
 href="https://acisinternational.org/conferences/sera-2025/" - SERA 2025 
 href="https://acisinternational.org/conferences/snpd-2025-summeri/" - SNPD 2025-Summer I 
 href="https://acisinternational.org/conferences/eaim-2024/" - EAIM 2025 
 href="https://acisinternational.org/conferences/snpd-2025-summer-ii/" - SNPD 2025-Summer II 
 href="https://acisinternational.org/conferences/snpd-2025-summer-iii/" - SNPD 2025-Summer III 
 href="https://acisinternational.org/conferences/snpd-2025-summer-iv/" - SNPD 2025-Summer IV 
 href="https://acisinternational.org/conferences/snpd2025-winter/" - SNPD2025-Winter 
 Officers 
 ACIS Publications | IJNDC 
 IJSI 
 IJBDIA 
 Springer 
 Past Conferences | Past Conferences 
 Past Conference Photos 
 SpecialSession/Workshop/Symposium Info | Organizer Instructions 
 Proposal Form 
 Review Form 
 Virtual Conference Instructions 
 SERA 2025 
 The 23rd IEEE/ACIS International Conference on Software Engineering, Management and Applications (SERA 2025) 
 Venue: UNLV Campus 
 Date: May 29-31, 2025 
 Las Vegas, USA 
 Conference Venue Location 
 UNLV Campus, Las Vegas, Nevada, USA 
 . 
 Important Dates 
 Workshop/Special Session Proposal: January 10, 2025 
 Full Paper Submission: March 28, 2025 (extended) 
 Acceptance Notification (papers submitted by March 14):April 11, 2025 (postponed) 
 Acceptance Notification (Papers submitted after March 14):April 11, 2025 
 Camera Ready Papers/Registration: April 18, 2025 
 The 23rd IEEE/ACIS International Conference on Software Engineering, Management and Applications (SERA 2025) brings together researchers, scientists, engineers, industry practitioners, and students to discuss, encourage and exchange new ideas, research results, and experiences on all aspects of Software Engineering, Management and Applications. SERA 2025 aims to facilitate cross-fertilizations among, and is soliciting papers in the key technology enabling areas. 
 href="http://acisinternational.org/wp-content/uploads/2025/03/SERA_2025_CFP-9.pdf" - Call For Papers
href="https://acisinternational.org/sera-2025-paper-submission-for-review-2/" - Paper Submission Instructions
href="https://acisinternational.org/sera-2025-special-sessions" - Special Sessions
href="http://acisinternational.org/wp-content/uploads/2025/01/WorkshopSpecialSessionProposal1-25.pdf" - Special Session/Workshop Proposal Form
href="http://acisinternational.org/wp-content/uploads/2024/09/SERA2025FeeSchedule.pdf" - Fee Schedule
Register Now 
 href="https://acisinternational.org/sera-2025-final-paper-submission-instructions-2" - Final Paper Submissions
href="https://acisinternational.org/sera-2025-accommodations-2" - Accommodations
Travel Information 
 href="http://acisinternational.org/wp-content/uploads/2025/04/Lawrence_Chung_abstact_and_short_bio-SERA25.pdf" - Keynote Speakers
href="https://acisinternational.org/tba" - Accepted Papers
Conference Program 
 PC Members 
 ABOUT ACIS 
 ACIS provides a forum for researchers in education and industry from all over the world to interact with one another and disseminate the latest developments in the fields of computer and information science. 
 RECENT NEWS 
 QUICK LINKS 
 Home 
 Membership 
 Conference Calendar 
 Officers 
 ACIS Publications 
 Past Conferences 
 SpecialSession/Workshop/Symposium Info 
 Virtual Conference Instructions 
 CONTACT INFO 
 Michigan Office 
 619 S Mission St, Mt. 
 Mt. Pleasant, MI 48858, U.S.A. 
 Florida Office 
 4088 Basket Oak Cir. 
 Vero Beach, FL 32967, U.S.A. 
 Email:acis@acisinternational.org 
 © Copyright 2018 ACIS International. All Rights Reserved Built byGriffusTech 
 Home | ACIS News 
 Contact Us 
 About 
 Membership 
 Conference Calendar | href="https://acisinternational.org/conferences/bcd-2024-winter/" - BCD 2025-Winter 
 href="https://acisinternational.org/conferences/sera-2025/" - SERA 2025 
 href="https://acisinternational.org/conferences/snpd-2025-summeri/" - SNPD 2025-Summer I 
 href="https://acisinternational.org/conferences/eaim-2024/" - EAIM 2025 
 href="https://acisinternational.org/conferences/snpd-2025-summer-ii/" - SNPD 2025-Summer II 
 href="https://acisinternational.org/conferences/snpd-2025-summer-iii/" - SNPD 2025-Summer III 
 href="https://acisinternational.org/conferences/snpd-2025-summer-iv/" - SNPD 2025-Summer IV 
 href="https://acisinternational.org/conferences/snpd2025-winter/" - SNPD2025-Winter 
 Officers 
 ACIS Publications | IJNDC 
 IJSI 
 IJBDIA 
 Springer 
 Past Conferences | Past Conferences 
 Past Conference Photos 
 SpecialSession/Workshop/Symposium Info | Organizer Instructions 
 Proposal Form 
 Review Form 
 Virtual Conference Instructions

2. Website of SERA_1: https://acisinternational.org/conferences/sera-2025/
Website information of SERA_1:

Home | ACIS News 
 Contact Us 
 About 
 Membership 
 Conference Calendar | href="https://acisinternational.org/conferences/bcd-2024-winter/" - BCD 2025-Winter 
 href="https://acisinternational.org/conferences/sera-2025/" - SERA 2025 
 href="https://acisinternational.org/conferences/snpd-2025-summeri/" - SNPD 2025-Summer I 
 href="https://acisinternational.org/conferences/eaim-2024/" - EAIM 2025 
 href="https://acisinternational.org/conferences/snpd-2025-summer-ii/" - SNPD 2025-Summer II 
 href="https://acisinternational.org/conferences/snpd-2025-summer-iii/" - SNPD 2025-Summer III 
 href="https://acisinternational.org/conferences/snpd-2025-summer-iv/" - SNPD 2025-Summer IV 
 href="https://acisinternational.org/conferences/snpd2025-winter/" - SNPD2025-Winter 
 Officers 
 ACIS Publications | IJNDC 
 IJSI 
 IJBDIA 
 Springer 
 Past Conferences | Past Conferences 
 Past Conference Photos 
 SpecialSession/Workshop/Symposium Info | Organizer Instructions 
 Proposal Form 
 Review Form 
 Virtual Conference Instructions 
 SERA 2025 
 The 23rd IEEE/ACIS International Conference on Software Engineering, Management and Applications (SERA 2025) 
 Venue: UNLV Campus 
 Date: May 29-31, 2025 
 Las Vegas, USA 
 Conference Venue Location 
 UNLV Campus, Las Vegas, Nevada, USA 
 . 
 Important Dates 
 Workshop/Special Session Proposal: January 10, 2025 
 Full Paper Submission: March 28, 2025 (extended) 
 Acceptance Notification (papers submitted by March 14):April 11, 2025 (postponed) 
 Acceptance Notification (Papers submitted after March 14):April 11, 2025 
 Camera Ready Papers/Registration: April 18, 2025 
 The 23rd IEEE/ACIS International Conference on Software Engineering, Management and Applications (SERA 2025) brings together researchers, scientists, engineers, industry practitioners, and students to discuss, encourage and exchange new ideas, research results, and experiences on all aspects of Software Engineering, Management and Applications. SERA 2025 aims to facilitate cross-fertilizations among, and is soliciting papers in the key technology enabling areas. 
 href="http://acisinternational.org/wp-content/uploads/2025/03/SERA_2025_CFP-9.pdf" - Call For Papers
href="https://acisinternational.org/sera-2025-paper-submission-for-review-2/" - Paper Submission Instructions
href="https://acisinternational.org/sera-2025-special-sessions" - Special Sessions
href="http://acisinternational.org/wp-content/uploads/2025/01/WorkshopSpecialSessionProposal1-25.pdf" - Special Session/Workshop Proposal Form
href="http://acisinternational.org/wp-content/uploads/2024/09/SERA2025FeeSchedule.pdf" - Fee Schedule
Register Now 
 href="https://acisinternational.org/sera-2025-final-paper-submission-instructions-2" - Final Paper Submissions
href="https://acisinternational.org/sera-2025-accommodations-2" - Accommodations
Travel Information 
 href="http://acisinternational.org/wp-content/uploads/2025/04/Lawrence_Chung_abstact_and_short_bio-SERA25.pdf" - Keynote Speakers
href="https://acisinternational.org/tba" - Accepted Papers
Conference Program 
 PC Members 
 Loading data... 
 ABOUT ACIS 
 ACIS provides a forum for researchers in education and industry from all over the world to interact with one another and disseminate the latest developments in the fields of computer and information science. 
 RECENT NEWS 
 QUICK LINKS 
 Home 
 Membership 
 Conference Calendar 
 Officers 
 ACIS Publications 
 Past Conferences 
 SpecialSession/Workshop/Symposium Info 
 Virtual Conference Instructions 
 CONTACT INFO 
 Michigan Office 
 619 S Mission St, Mt. 
 Mt. Pleasant, MI 48858, U.S.A. 
 Florida Office 
 4088 Basket Oak Cir. 
 Vero Beach, FL 32967, U.S.A. 
 Email:acis@acisinternational.org 
 © Copyright 2018 ACIS International. All Rights Reserved Built byGriffusTech 
 Home | ACIS News 
 Contact Us 
 About 
 Membership 
 Conference Calendar | href="https://acisinternational.org/conferences/bcd-2024-winter/" - BCD 2025-Winter 
 href="https://acisinternational.org/conferences/sera-2025/" - SERA 2025 
 href="https://acisinternational.org/conferences/snpd-2025-summeri/" - SNPD 2025-Summer I 
 href="https://acisinternational.org/conferences/eaim-2024/" - EAIM 2025 
 href="https://acisinternational.org/conferences/snpd-2025-summer-ii/" - SNPD 2025-Summer II 
 href="https://acisinternational.org/conferences/snpd-2025-summer-iii/" - SNPD 2025-Summer III 
 href="https://acisinternational.org/conferences/snpd-2025-summer-iv/" - SNPD 2025-Summer IV 
 href="https://acisinternational.org/conferences/snpd2025-winter/" - SNPD2025-Winter 
 Officers 
 ACIS Publications | IJNDC 
 IJSI 
 IJBDIA 
 Springer 
 Past Conferences | Past Conferences 
 Past Conference Photos 
 SpecialSession/Workshop/Symposium Info | Organizer Instructions 
 Proposal Form 
 Review Form 
 Virtual Conference Instructions

3. Website of SERA_2: https://www.unlv.edu/news/unlvtoday/ieeeacis-international-conference-software-engineering-management-applications-may
Website information of SERA_2:

Skip to main contentUniversity of Nevada, Las VegasStudents 
 Faculty/Staff 
 Alumni 
 Donors 
 AudiencesStudents 
 Faculty/Staff 
 Alumni 
 Donors 
 href="#" - Topics
About 
 Academics 
 Admissions 
 Athletics 
 Campus Life 
 href="/r1-research" - Research 
 MenuUniversity of Nevada, Las Vegas 
 News CenterNews CenterAbout 
 Academics 
 Admissions 
 Athletics 
 Campus Life 
 href="/r1-research" - Research 
 Findclose News Center menu 
 News Center 
 News Center Home | About 
 Search 
 Browse | Browse Archive 
 Browse By Administrative Unit 
 Browse By College/School 
 Publications | Accomplishments 
 Class Notes 
 Experts Directory 
 UNLV In The News 
 UNLV Today Announcements 
 UNLV Magazine 
 Submit | Submit Class Note 
 Submit a UNLV Today Accomplishment or Announcement 
 Share a Story Idea 
 Contact Us 
 Procuring Goods or Services 
 close find region 
 Find 
 Search 
 A-Z Index 
 Directories 
  
 × | × | search 
 × 
 Custom Search 
  
 Sort by: 
 Relevance 
 Relevance 
 Date 
 Quick Links 
 Bookstore 
 Bookstore 
 Calendar 
 Calendar 
 Campus Maps 
 Campus Maps 
 Degrees 
 Degrees 
 Libraries 
 Libraries 
 MyUNLV 
 MyUNLV 
 News Center 
 News Center 
 RebelCard 
 RebelCard 
 Rebelmail 
 Rebelmail 
 Social Media 
 Social Media 
 UNLV Mail 
 UNLV Mail 
 WebCampus 
 WebCampus 
  
 LoadingDirectories Home 
 A-Z Index 
 Colleges, Schools, and Departments 
 Administrative Units 
 href="/directories/research-centers-institutes" - Research Centers and Institutes 
 Resources and Services 
 Employee Directory 
 Contact UNLV 
 Social Media Directory 
 UNLV Mobile Apps 
 Breadcrumb 
 UNLV Home 
 News Center Home 
 UNLV Today Home 
 IEEE/ACIS International Conference: Software Engineering, Management & Applications May 29-31 
 UNLV Today HomeIEEE/ACIS International Conference: Software Engineering, Management & Applications May 29-31Ju-Yeon Jo and Mingon Kang are hosting the 23rd IEEE/ACIS International Conference on Software Engineering, Management and Applications (SERA 2025). IEEE/ACIS SERA 2025 brings together researchers, scientists, engineers, industry practitioners, and students to discuss, encourage and exchange new ideas, research results, and experiences on all aspects of Software Engineering, Management and Applications. 
 The conference is May 29-31 at AEB. The engineering college supports the conference. 
 More InformationLogin & Submit New Announcement×More Information 
 Contact: Mingon Kang 
 Email:mingon.kang@unlv.edu 
 Phone:702-774-3416 
 April292025Category: 
 Save-The-Date 
 More of Today's Announcements 
 Announcements 
 LastPass Business Users: Book Password Reset Appointment Before July 31 
 Announcements 
 Administrative Faculty of the Month - Nominate Your Colleagues 
 People (new hires, retirements, etc.) 
 Classified Employee of the Month 
 People (new hires, retirements, etc.) 
 Rebel Spirit Award Recipients of the Quarter 
 Save-The-Date 
 UNLV Athletics Apparel and Equipment Sale - Staff & Student Presale on Friday 
 Save-The-Date 
 Lunch & Learn: Designing Student-Created Podcast Assignments with the Library May 12 
 People in the News 
 href="/news/article/class-2025-reflection-last-four-years" - Class of 2025: A Reflection on the Last Four Years
People | April 29, 2025 
 Class of 2025: A Reflection on the Last Four YearsFourth-year medical students reflect on their medical school journey one week before commencement. 
 The Sky’s the Limit: From Teen Entrepreneur to Real Estate TrailblazerPeople | April 29, 2025 
 The Sky’s the Limit: From Teen Entrepreneur to Real Estate TrailblazerSky Denson says UNLV's real estate program helped launch his career — before he even graduated. 
 The Interview: Kevin McVayPeople | April 28, 2025 
 The Interview: Kevin McVayThe assistant director of the Sciences Advising Center wants everyone to know: There's so much more to being an advisor than telling students what classes to take. 
 More People 
 Employment 
 UNLV Strong 
 Wellness 
 Community 
 Top Tier 2.0 
 Campus Notifications 
 University Statements and Compliance 
 Web Privacy Statement 
 Web Accessibility 
 href="/web/user-research" - Website Feedback 
 University of Nevada, Las Vegas 
 4505 S. Maryland Pkwy. 
 Las Vegas, NV 89154 
 Phone: 702-895-3011 
 Campus Maps 
 Parking Information 
 href="/about/copyright" - © 2025 UNLV 
 Produced by | UNLV Web & Digital Strategy 
 Social Media at UNLV


 `;

    // Gọi API để tạo nội dung
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    console.log("Nội dung được tạo ra:");
    console.log(text);

  } catch (error) {
    console.error("Đã xảy ra lỗi khi gọi Gemini API:", error);
  }
}

run();