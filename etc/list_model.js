async function listModelsWithSupportedMethods() {
  // THAY THẾ BẰNG KHÓA API CỦA BẠN. KHÔNG BAO GIỜ ĐỂ KHÓA API TRONG MÃ NGUỒN CÔNG KHAI.
  const apiKey = "AIzaSyCq_m6rNFrYovb5TXxiTfzKLbe84fg99SQ"; 
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      // Cung cấp thêm chi tiết khi có lỗi
      const errorData = await response.json();
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorData.error.message}`);
    }
    const data = await response.json();
    console.log("Danh sách các mô hình có sẵn và các phương thức được hỗ trợ:");
    
    data.models.forEach(model => {
      console.log(`- Tên hiển thị: ${model.displayName}`);
      console.log(`  Tên mô hình: ${model.name}`);
      console.log(`  Phiên bản: ${model.version}`);
      console.log(`  Mô tả: ${model.description}`);
      
      // Kiểm tra và in các phương thức được hỗ trợ
      if (model.supportedGenerationMethods && model.supportedGenerationMethods.length > 0) {
        console.log(`  Phương thức được hỗ trợ: ${model.supportedGenerationMethods.join(', ')}`);
      } else {
        console.log("  Không có thông tin về phương thức được hỗ trợ.");
      }
      
      console.log('---');
    });

  } catch (error) {
    console.error("Lỗi khi lấy danh sách mô hình:", error);
  }
}

// Gọi hàm để thực thi
listModelsWithSupportedMethods();