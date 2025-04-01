import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import csvParser from 'csv-parser';

// Định nghĩa __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cấu hình
const MAX_TABS = 5; // Số lượng tab chạy song song
const INPUT_CSV = path.join(__dirname, 'import_journal.csv'); // File CSV đầu vào
const OUTPUT_CSV = path.join(__dirname, 'journal_with_country.csv');
const OUTPUT_JSON = path.join(__dirname, 'journal_details.json');
const OUTPUT_IF_JSON = path.join(__dirname, 'impact_factor_details.json');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// Tiêu đề của file CSV
const CSV_HEADERS = `Title,Type,SJR,H index,Total Docs. (2023),Total Docs. (3years),Total Refs. (2023),Total Cites (3years),Citable Docs. (3years),Cites / Doc. (2years),Ref. / Doc. (2023),%Female (2023),Country,Details\n`;


// Đọc file CSV
const readCSV = async (filePath) => {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
};

// Hàm crawl Bioxbio
const fetchBioxbioData = async (page, bioxbioSearchUrl, journalName) => {
  try {
    await page.goto(bioxbioSearchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('a.gs-title', { timeout: 5000 });

    const redirectUrl = await page.evaluate((journalName) => {
      const link = document.querySelector('a.gs-title');

      if (!link) {
        console.log('Không tìm thấy thẻ <a> với class "gs-title".');
        return null;
      }

      // Lấy nội dung của thẻ <b> bên trong
      const linkText = link.querySelector('b')?.textContent.trim();

      
      // So sánh tên tạp chí (bỏ qua chữ hoa, chữ thường và khoảng trắng thừa)
      if (linkText && linkText.toLowerCase().replace(/\s+/g, ' ') === journalName.toLowerCase().replace(/\s+/g, ' ')) {
        const dataCtorig = link.getAttribute('data-ctorig'); // Lấy giá trị thuộc tính "data-ctorig"
        return dataCtorig;
      }

      return null;
    }, journalName);

    if (!redirectUrl) {
      return null;
    }

    await page.goto(redirectUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const impactFactors = await page.evaluate(() => {
      const data = [];
      const rows = document.querySelectorAll('tr:nth-child(n+2)');
      rows.forEach((row) => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          const year = cells[0]?.textContent.trim();
          const impactFactor = cells[1]?.textContent.trim();
          if (year && impactFactor) {
            data.push({ Year: year, Impact_factor: impactFactor });
          }
        }
      });
      return data;
    });

    return impactFactors;
  } catch (error) {
    return null;
  }
};

// Hàm lấy thông tin từ bảng chi tiết trong liên kết
const fetchDetails = async (page, journalUrl) => {
  if (!journalUrl) return null;

  try {
    await page.goto(journalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Lấy dữ liệu từ các selectors
    const details = await page.evaluate(() => {
      const selectors = [
        'body > div:nth-child(13) > div > div > div:nth-child(2)',
        'body > div:nth-child(13) > div > div > div:nth-child(3)',
        'body > div:nth-child(13) > div > div > div:nth-child(6)',
        'body > div:nth-child(13) > div > div > div:nth-child(8)',
      ];

      const result = {};
      selectors.forEach((selector) => {
        const element = document.querySelector(selector);
        if (element) {
          // Lấy text của phần tử <h2> làm key
          const key = element.querySelector('h2')?.textContent.trim();
          if (key) {
            // Nếu là phần tử thứ 8, xử lý đặc biệt
            if (selector === 'body > div:nth-child(13) > div > div > div:nth-child(8)') {
              const links = element.querySelectorAll('p > a');
              const homepage = links[0]?.href || null;
              const howToPublish = links[1]?.href || null;
              const mail = links[2]?.textContent.includes('@') ? links[2].textContent.trim() : null;

              result[key] = {
                Homepage: homepage,
                "How to publish in this journal": howToPublish,
                Mail: mail,
              }
            } else if (selector === 'body > div:nth-child(13) > div > div > div:nth-child(2)') {
                const subjectAreaElement = document.querySelector('body > div:nth-child(13) > div > div > div:nth-child(2) ul');
                const fieldOfResearch = {};
                const mainTopicElement = subjectAreaElement.querySelector('li > a');
                
                if (mainTopicElement) {
                  // Lấy chủ đề lớn (chủ đề đầu tiên trong <ul>)
                  const mainTopic = mainTopicElement.textContent.trim();
                  fieldOfResearch['Field of Research'] = mainTopic;

                  // Lấy các chủ đề con từ ul.treecategory
                  const subTopicElements = subjectAreaElement.querySelectorAll('.treecategory li a');
                  const topics = [];
                  subTopicElements.forEach((item) => {
                    const subTopic = item.textContent.trim();
                    topics.push(subTopic);
                  });
                  // Cập nhật vào result
                  fieldOfResearch['Topics'] = topics;
                }
                // Thêm vào kết quả tổng
                result['Subject Area and Category'] = fieldOfResearch;

            } else {
              // Lấy phần còn lại làm value (bao gồm cả text và các phần tử con)
              const value = Array.from(element.childNodes)  
                  .filter((node) => node.nodeType === Node.TEXT_NODE || 
                                  (node.nodeType === Node.ELEMENT_NODE && 
                                    node.tagName.toLowerCase() !== 'h2' && 
                                    node.textContent.trim()))
                  .map((node) => node.textContent.trim())
                  .join(' '); // Ghép các phần tử con thành một chuỗi
              result[key] = value.trim();

            }

          }
        }
      });
      // Lấy thông tin từ phần tử fullwidth
      const fullwidthElement = document.querySelector('body > div:nth-child(13) > div > div > div.fullwidth');
      if (fullwidthElement) {
        const key = fullwidthElement.firstElementChild?.textContent.trim() || 'Additional Info';
        const value = Array.from(fullwidthElement.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE || 
                                (node.nodeType === Node.ELEMENT_NODE && 
                                  node.tagName.toLowerCase() !== 'h2' && 
                                  node.tagName.toLowerCase() !== 'a' && 

                                  node.textContent.trim()))
          .map((node) => node.textContent.trim())
          .join(' ');
        result[key] = value.trim();
      }



      // Lấy bảng bổ sung (nếu có)
      const supplementaryTableSelector =
        'body > div:nth-child(14) > div > div.cellcontent > div:nth-child(2) > table';
      const supplementaryTable = document.querySelector(supplementaryTableSelector);
      if (supplementaryTable) {
        const supplementaryData = [];
        const rows = supplementaryTable.querySelectorAll('tbody tr');
        rows.forEach((row) => {
          const cells = row.querySelectorAll('td');
          if (cells.length === 3) {
            supplementaryData.push({
              Category: cells[0].textContent.trim(),
              Year: cells[1].textContent.trim(),
              Quartile: cells[2].textContent.trim(),
            });
          }
        });
        result['SupplementaryTable'] = supplementaryData;
      }

      // Lấy thông tin từ #embed_code để làm ảnh đại diện
      const embedCodeElement = document.querySelector('#embed_code');
      if (embedCodeElement) {
        const thumbnailText = embedCodeElement.getAttribute('value');
        if (thumbnailText) {
          result['Thumbnail'] = thumbnailText.trim();
        }
      }

      return result;
    });

    // Extract ISSN and fetch image if available
    const issnText = details['ISSN']?.trim();
    console.log(`[INFO] ISSN Text Extracted: ${issnText}`);

    if(issnText){
      const issnValues = issnText.split(',').map(item => item.trim()); // Split by comma and trim spaces
      const issnToSearch = issnValues[1] || issnValues[0]; // Use the second if available, else first
      
      if (issnToSearch){
        console.log(`[INFO] ISSN ISSN to search: ${issnToSearch}`);

        // Thêm logic để định dạng ISSN đúng chuẩn nếu không có dấu gạch ngang
        const formattedISSN = issnToSearch.replace(/(\d{4})(\d{4})/, '$1-$2');
        console.log(`[INFO] formattedISSN: ${formattedISSN}`);        
        const issnMatch = formattedISSN.match(/(\d{4})-(\d{4})/);

        if (issnMatch) {
            console.log(`[INFO] issnMatch: ${issnMatch}`);

            const formattedISSN = `${issnMatch[1]}-${issnMatch[2]}`;
            console.log(`[INFO] formattedISSN: ${formattedISSN}`);

            const googleSearchURL = `https://www.google.com/search?q=ISSN+"${formattedISSN}"&udm=2`;
            console.log(`[INFO] Google Search URL: ${googleSearchURL}`);

            // const googlePage = await browser.newPage();
            try {
              console.log(`[INFO] Navigating to Google Search Page.`);

              await page.goto(googleSearchURL, { waitUntil: 'domcontentloaded', timeout: 60000 });
              console.log(`[INFO] Google Search Page loaded.`);
              console.log(`[INFO] Waiting for selector: div.F0uyec.`);

              // Nhấp vào selector `div.F0uyec` nếu có
              const f0uyecExists = await page.$('div.F0uyec');
              if (f0uyecExists) {
                await f0uyecExists.click();
              }

              // Đợi `div` có thuộc tính `jsname="figiqf"` xuất hiện
              await page.waitForSelector('div[jsname="figiqf"] img', { timeout: 10000 });

              // Lấy giá trị thuộc tính `src` của thẻ `<img>` trong `div[jsname="figiqf"]`
              const imageSrc = await page.evaluate(() => {
                const imgElement = document.querySelector('div[jsname="figiqf"] img');
                return imgElement ? imgElement.getAttribute('src') : null;
              });

              if (imageSrc) {
                details['Image'] = imageSrc;
              }
            } catch(error){
              console.error(`Lỗi khi lấy image từ Google:`, error);
            } finally {
                await page.close();
            }
        }
      } else{
        console.log(`[WARN] No ISSN found to search after split: ${issnText}`);
    }

    }
    
    return details;
  } catch (error) {
    console.error(`Lỗi khi lấy thông tin chi tiết từ ${journalUrl}`, error);
    return null;
  }
};

(async () => {
  const browser = await chromium.launch({
    headless: false,
    executablePath: EDGE_PATH,
  });

  const context = await browser.newContext();
  await context.route("**/*", (route) => {
    const request = route.request();
    const resourceType = route.request().resourceType();
    if (['image', 'media', 'font'].includes(resourceType) ||
      request.url().includes("google-analytics") ||
      request.url().includes("ads") ||
      request.url().includes("tracking") ||
      request.url().includes("google_vignette")
    ) {
        route.abort();
      } else {
        route.continue();
      }
  });

  const csvData = await readCSV(INPUT_CSV);
  const pages = await Promise.all(Array.from({ length: MAX_TABS }, () => context.newPage()));

  const csvResults = [];
  const jsonResults = [];
  const impactFactorResults = [];


  // Hàm xử lý mỗi tab độc lập
  const processTab = async (page, row) => {
    const { Title, Sourceid } = row;
    const journalName = Title;
    const journalLink = `https://www.scimagojr.com/journalsearch.php?q=${Sourceid}&tip=sid&clean=0`;

    if (journalName) {
      console.log(`Tìm kiếm thông tin Bioxbio cho tạp chí: ${journalName}`);
      const bioxbioSearchUrl = `https://www.bioxbio.com/?q=${encodeURIComponent(journalName)}`;
      const bioxbioData = await fetchBioxbioData(page, bioxbioSearchUrl, journalName);

      if (bioxbioData) {
        impactFactorResults.push({ journalName, impactFactors: bioxbioData });
      }
    }

    if (journalLink) {
      console.log(`Fetching details for: ${journalLink}`);
      const details = await fetchDetails(page, journalLink);
      if (details) {
        jsonResults.push({ link: journalLink, details });
      }
    }

    csvResults.push(`${journalName},${journalLink}`);
  };

  for (let i = 0; i < csvData.length; i += MAX_TABS) {
    const batch = csvData.slice(i, i + MAX_TABS);
    await Promise.all(
      batch.map((row, idx) => processTab(pages[idx], row))
    );
  }

  // Ghi kết quả vào file
  fs.writeFileSync(OUTPUT_CSV, csvResults.join('\n'), 'utf8');
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(jsonResults, null, 2), 'utf8');
  fs.writeFileSync(OUTPUT_IF_JSON, JSON.stringify(impactFactorResults, null, 2), 'utf8');

  console.log(`Dữ liệu đã được lưu vào CSV: ${OUTPUT_CSV}`);
  console.log(`Chi tiết đã được lưu vào JSON: ${OUTPUT_JSON}`);

  await browser.close();
})();

