import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.DATA_GO_KR_API_KEY;

async function testApi() {
  const baseUrl = 'http://apis.data.go.kr/1613000/BldRgstService_v2/getBrTitleInfo';
  const url = `${baseUrl}?serviceKey=${API_KEY}&sigunguCd=11680&bjdongCd=10600&platGbCd=0&bun=0893&ji=0000&numOfRows=10&pageNo=1&_type=json`;
  
  try {
    const response = await axios.get(url, { timeout: 10000 });
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    if (error.response) {
      console.log('Error Data:', error.response.data);
    } else {
      console.error('API Error:', error.message);
    }
  }
}

testApi();
