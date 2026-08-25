import axios from 'axios';

async function fetchInfo() {
  try {
    const response = await axios.get('https://www.data.go.kr/data/15134735/openapi.do');
    const html = response.data;
    const matches = html.match(/http:\/\/apis\.data\.go\.kr[^\s"']+/g);
    if (matches) {
      console.log('Endpoints found:', [...new Set(matches)]);
    } else {
      console.log('No endpoints found in HTML');
    }
  } catch (e) {
    console.error('Fetch error:', e.message);
  }
}

fetchInfo();
