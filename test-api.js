const key = decodeURIComponent('JRx0aQkyfDBquXPI1TziFRlBY%2BqBHe0FBYePrQL8k%2FlPo92bvFrg0AplgKwWfNLFrsuEq8ABzPUaJuJSkBC9BQ%3D%3D');
const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${encodeURIComponent(key)}&LAWD_CD=26140&DEAL_YMD=202606&numOfRows=10`;
fetch(url).then(r=>r.text()).then(console.log);
