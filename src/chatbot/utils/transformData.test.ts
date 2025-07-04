// src/chatbot/utils/transformData.test.ts

import { transformConferenceData } from './transformData'; // Import hàm cần test
import { summaryData, detailData } from './mockData';   // Import dữ liệu mẫu

/**
 * Main function to run the tests.
 */
function runTests() {
  console.log('================================================================');
  console.log('🚀 STARTING DATA TRANSFORMATION TESTS 🚀');
  console.log('================================================================\n');

  // --- Test Case 1: Summary Mode ---
  console.log('--- 🧪 TEST 1: SUMMARY MODE ---');
  const summaryQuery = 'search?acronym=JSSPP'; // A typical summary query
  // @ts-ignore - We are intentionally passing a simplified data structure for the test
  const summaryOutput = transformConferenceData(summaryData, summaryQuery);
  console.log(summaryOutput);
  console.log('--- ✅ TEST 1 COMPLETE ---\n');


  console.log('================================================================\n');


  // --- Test Case 2: Detail Mode ---
  console.log('--- 🧪 TEST 2: DETAIL MODE ---');
  const detailQuery = 'search?id=00c6bf0f-520c-4702-8261-f929cfc51ed9&mode=detail'; // A typical detail query
  // @ts-ignore - We are intentionally passing a simplified data structure for the test
  const detailOutput = transformConferenceData(detailData, detailQuery);
  console.log(detailOutput);
  console.log('--- ✅ TEST 2 COMPLETE ---\n');
}

// Execute the tests
runTests();