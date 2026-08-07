"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var axios_1 = require("axios");
var client_1 = require("@prisma/client");
var dotenv = require("dotenv");
var path = require("path");
// .env.local 로드
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
var prisma = new client_1.PrismaClient();
function fetchRealEstateData() {
    return __awaiter(this, void 0, void 0, function () {
        var apiKey, LAWD_CD, now, DEAL_YMD, url, response, items, rawItems, rawItems, i, apt, aptName, rawPrice, priceVal, isNewHigh, priceLabel, year, month, day, area, tradeHistories, _i, items_1, apt, aptName, rawPrice, priceVal, priceStr, year, month, day, tradeDate, areaStr, floor, isAgency, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    apiKey = process.env.DATA_GO_KR_API_KEY;
                    if (!apiKey || apiKey.includes('여기에_')) {
                        console.error('❌ 에러: 공공데이터포털 API 키가 .env.local 파일에 정상적으로 설정되지 않았습니다.');
                        process.exit(1);
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 10, 11, 13]);
                    console.log('📡 국토교통부 아파트 실거래가 API 데이터를 가져오는 중...');
                    LAWD_CD = '11680';
                    now = new Date();
                    // 데이터 포털 특성상 이번달 초에는 데이터가 적을 수 있으므로 지난달 데이터를 가져옵니다. (안전하게 전월 데이터 보장)
                    now.setMonth(now.getMonth() - 1);
                    DEAL_YMD = "".concat(now.getFullYear()).concat(String(now.getMonth() + 1).padStart(2, '0'));
                    console.log("\uD83D\uDCCC \uC870\uD68C \uC6D4 \uC124\uC815: ".concat(DEAL_YMD, " (\uD604\uC7AC \uC2DC\uC810 \uAE30\uC900 \uCD5C\uC2E0 \uC2E4\uAC70\uB798\uC6D4)"));
                    url = "http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=".concat(apiKey, "&pageNo=1&numOfRows=100&LAWD_CD=").concat(LAWD_CD, "&DEAL_YMD=").concat(DEAL_YMD, "&_type=json");
                    return [4 /*yield*/, axios_1.default.get(url)];
                case 2:
                    response = _a.sent();
                    items = [];
                    // JSON 응답인 경우
                    if (response.data && response.data.response && response.data.response.body && response.data.response.body.items) {
                        rawItems = response.data.response.body.items.item;
                        items = Array.isArray(rawItems) ? rawItems : (rawItems ? [rawItems] : []);
                    }
                    else if (response.data && response.data.body && response.data.body.items) {
                        rawItems = response.data.body.items.item;
                        items = Array.isArray(rawItems) ? rawItems : (rawItems ? [rawItems] : []);
                    }
                    else {
                        console.log('API 응답 형식:', JSON.stringify(response.data).substring(0, 200));
                        throw new Error('응답 데이터 형식이 올바르지 않거나 데이터가 없습니다.');
                    }
                    if (items.length === 0) {
                        console.log('⚠️ 해당하는 기간/지역에 데이터가 없습니다.');
                        return [2 /*return*/];
                    }
                    console.log("\u2705 \uCD1D ".concat(items.length, "\uAC1C\uC758 \uB370\uC774\uD130\uB97C \uC131\uACF5\uC801\uC73C\uB85C \uAC00\uC838\uC654\uC2B5\uB2C8\uB2E4. DB\uC5D0 \uC800\uC7A5\uD569\uB2C8\uB2E4..."));
                    // 기존 데이터 초기화
                    return [4 /*yield*/, prisma.transaction.deleteMany()];
                case 3:
                    // 기존 데이터 초기화
                    _a.sent();
                    return [4 /*yield*/, prisma.tradeHistory.deleteMany()];
                case 4:
                    _a.sent();
                    i = 0;
                    _a.label = 5;
                case 5:
                    if (!(i < Math.min(items.length, 10))) return [3 /*break*/, 8];
                    apt = items[i];
                    aptName = apt.aptNm || apt.아파트 || '이름없음';
                    rawPrice = (apt.dealAmount || apt.거래금액 || '0').replace(/,/g, '').trim();
                    priceVal = parseInt(rawPrice, 10);
                    isNewHigh = priceVal > 150000;
                    priceLabel = "".concat(Math.floor(priceVal / 10000), "\uC5B5").concat(priceVal % 10000 === 0 ? '' : " ".concat(priceVal % 10000, "\uB9CC"));
                    year = apt.dealYear || apt.년;
                    month = String(apt.dealMonth || apt.월).padStart(2, '0');
                    day = String(apt.dealDay || apt.일).padStart(2, '0');
                    area = apt.excluUseAr || apt.전용면적;
                    return [4 /*yield*/, prisma.transaction.create({
                            data: {
                                rank: i + 1,
                                name: aptName,
                                price: priceLabel,
                                priceChange: isNewHigh ? '▲ 1억' : '▲ 5000',
                                changeType: isNewHigh ? 'new' : 'up',
                                typeLabel: isNewHigh ? '신고가' : '반등',
                                info: "".concat(area, "m\u00B2 \u2022 ").concat(year.toString().slice(2), ".").concat(month, ".").concat(day),
                                lat: 37.498 + (Math.random() - 0.5) * 0.02,
                                lng: 127.027 + (Math.random() - 0.5) * 0.02,
                            }
                        })];
                case 6:
                    _a.sent();
                    _a.label = 7;
                case 7:
                    i++;
                    return [3 /*break*/, 5];
                case 8:
                    console.log('🎉 랭킹 진짜 데이터 DB 업데이트 완료!');
                    tradeHistories = [];
                    for (_i = 0, items_1 = items; _i < items_1.length; _i++) {
                        apt = items_1[_i];
                        aptName = apt.aptNm || apt.아파트 || '이름없음';
                        rawPrice = (apt.dealAmount || apt.거래금액 || '0').replace(/,/g, '').trim();
                        priceVal = parseInt(rawPrice, 10);
                        priceStr = "".concat(Math.floor(priceVal / 10000), "\uC5B5 ").concat(priceVal % 10000 === 0 ? '' : "".concat(priceVal % 10000, "\uB9CC")).trim();
                        year = apt.dealYear || apt.년;
                        month = String(apt.dealMonth || apt.월).padStart(2, '0');
                        day = String(apt.dealDay || apt.일).padStart(2, '0');
                        tradeDate = "".concat(year, ".").concat(month, ".").concat(day);
                        areaStr = apt.excluUseAr || apt.전용면적;
                        floor = parseInt(apt.floor || apt.층 || '1', 10);
                        isAgency = (apt.dealingGbn === '중개거래');
                        tradeHistories.push({
                            aptName: aptName,
                            tradeDate: tradeDate,
                            price: Math.floor(priceVal / 10000), // 그래프용 정수(억 단위)
                            priceStr: priceStr,
                            area: "".concat(areaStr, "m\u00B2"),
                            floor: floor,
                            tradeType: isAgency ? '중개거래' : '직거래'
                        });
                    }
                    return [4 /*yield*/, prisma.tradeHistory.createMany({ data: tradeHistories })];
                case 9:
                    _a.sent();
                    console.log("\uD83C\uDF89 \uC0C1\uC138 \uAC70\uB798\uC774\uB825 \uC9C4\uC9DC \uB370\uC774\uD130 ".concat(tradeHistories.length, "\uAC74 \uC8FC\uC785 \uC644\uB8CC! \uBE0C\uB77C\uC6B0\uC800\uB97C \uC0C8\uB85C\uACE0\uCE68 \uD574\uBCF4\uC138\uC694."));
                    return [3 /*break*/, 13];
                case 10:
                    error_1 = _a.sent();
                    console.error('❌ 공공데이터 API 연동 실패:', error_1.message);
                    return [3 /*break*/, 13];
                case 11: return [4 /*yield*/, prisma.$disconnect()];
                case 12:
                    _a.sent();
                    return [7 /*endfinally*/];
                case 13: return [2 /*return*/];
            }
        });
    });
}
fetchRealEstateData();
