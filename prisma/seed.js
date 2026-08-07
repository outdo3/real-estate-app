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
var client_1 = require("@prisma/client");
var prisma = new client_1.PrismaClient();
function main() {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: 
                // 기존 데이터 초기화
                return [4 /*yield*/, prisma.transaction.deleteMany()
                    // 반등 데이터
                ];
                case 1:
                    // 기존 데이터 초기화
                    _a.sent();
                    // 반등 데이터
                    return [4 /*yield*/, prisma.transaction.createMany({
                            data: [
                                { rank: 1, name: '당산현대3차', price: '17억', priceChange: '▲ 7억6천500', changeType: 'up', typeLabel: '반등', info: '73.27m² 25평 • 26.07.18', lat: 37.527341, lng: 126.904838 },
                                { rank: 2, name: '광명역써밋플레이스', price: '14억8천', priceChange: '▲ 3억4천', changeType: 'up', typeLabel: '반등', info: '84.853m² 36평 • 26.07.08', lat: 37.424368, lng: 126.883701 },
                                { rank: 3, name: '장미마을(현대)', price: '14억5천', priceChange: '▲ 5억8천', changeType: 'up', typeLabel: '반등', info: '74.61m² 27평 • 26.07.10', lat: null, lng: null },
                                { rank: 4, name: 'DMC센트레빌', price: '14억2천', priceChange: '▲ 2억2천', changeType: 'up', typeLabel: '반등', info: '114.85m² 43평 • 26.08.03', lat: null, lng: null },
                            ]
                        })
                        // 신고가 데이터
                    ];
                case 2:
                    // 반등 데이터
                    _a.sent();
                    // 신고가 데이터
                    return [4 /*yield*/, prisma.transaction.createMany({
                            data: [
                                { rank: 1, name: '디에이치아너힐즈', price: '53억', priceChange: '▲ 2억5천', changeType: 'new', typeLabel: '신고가', info: '105.82m² 41평 • 26.08.01', lat: 37.483983, lng: 127.066497 },
                                { rank: 2, name: '메이플자이', price: '49억', priceChange: '▲ 1억2천', changeType: 'new', typeLabel: '신고가', info: '99.5m² 38평 • 26.08.02', lat: null, lng: null },
                            ]
                        })];
                case 3:
                    // 신고가 데이터
                    _a.sent();
                    console.log('Seed data inserted successfully.');
                    return [2 /*return*/];
            }
        });
    });
}
main()
    .catch(function (e) {
    console.error(e);
    process.exit(1);
})
    .finally(function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, prisma.$disconnect()];
            case 1:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); });
