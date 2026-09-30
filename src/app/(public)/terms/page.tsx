import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import Header from '@/components/Header';
import styles from './legal.module.css';

export const metadata: Metadata = {
  title: `이용약관 - ${siteConfig.name}`,
  description: `${siteConfig.name} 서비스 이용약관입니다.`,
  openGraph: buildOpenGraph({
    title: `이용약관 - ${siteConfig.name}`,
    description: `${siteConfig.name} 서비스 이용약관입니다.`,
  }),
};

export default function TermsPage() {
  return (
    <div className={styles.main}>
      <Header pageTitle="이용약관" />
      <div className="container">
        <div className={styles.content}>
          <p className={styles.updatedAt}>시행일자: 2026년 8월 11일</p>

          <div className={styles.section}>
            <h2>제1조 (목적)</h2>
            <p>
              이 약관은 개인 서비스 운영자(이하 &ldquo;운영자&rdquo;)가 제공하는 부동산 실거래가 정보 서비스 &ldquo;{siteConfig.name}&rdquo;
              (이하 &ldquo;서비스&rdquo;)의 이용과 관련하여 운영자와 이용자 간의 권리, 의무 및 책임사항, 기타 필요한 사항을 규정함을
              목적으로 합니다.
            </p>
          </div>

          <div className={styles.section}>
            <h2>제2조 (서비스의 내용)</h2>
            <p>서비스는 다음과 같은 기능을 제공합니다.</p>
            <ul>
              <li>국토교통부 공공데이터(실거래가 공개시스템) 기반 아파트 매매·전월세 실거래가 정보 제공</li>
              <li>지도 기반 단지 검색 및 AI 자연어 검색을 통한 조건별 단지 추천</li>
              <li>학군·학교 정보, 시장 통계·분석 자료 제공</li>
              <li>이용자 간 정보 공유를 위한 커뮤니티(게시판) 기능</li>
              <li>외부 부동산 플랫폼(네이버 부동산 등)으로의 매물 링크 연결</li>
            </ul>
            <p>
              서비스가 제공하는 정보는 공공데이터 및 제3자 오픈 API를 가공한 <b>참고용 정보</b>이며, 법적 효력을 갖는 중개 행위나
              투자 자문에 해당하지 않습니다. 운영자는 「공인중개사법」상 중개업자가 아니며, 실제 거래는 반드시 공인중개사 등
              관계 법령상 자격을 갖춘 자를 통해 진행하시기 바랍니다.
            </p>
          </div>

          <div className={styles.section}>
            <h2>제3조 (이용자의 의무)</h2>
            <ul>
              <li>이용자는 관계 법령, 이 약관의 규정, 이용안내 및 서비스와 관련하여 공지한 사항을 준수하여야 합니다.</li>
              <li>커뮤니티 게시물 작성 시 타인의 명예를 훼손하거나 허위 사실을 유포하는 행위, 저작권 등 타인의 권리를 침해하는
                행위를 해서는 안 됩니다.</li>
              <li>서비스의 정상적인 운영을 방해하는 행위(자동화된 수단을 이용한 과도한 요청, 크롤링 등)를 해서는 안 됩니다.</li>
              <li>타인의 계정을 도용하거나 허위 정보로 가입해서는 안 됩니다.</li>
            </ul>
          </div>

          <div className={styles.section}>
            <h2>제4조 (정보의 정확성 및 면책)</h2>
            <ul>
              <li>실거래가 정보는 국토교통부 실거래가 공개시스템 공공데이터를 원 데이터로 하며, 신고 지연·정정·해제 등의 사유로
                공공데이터와 실제 화면에 표시되는 정보 간에 시차나 오차가 발생할 수 있습니다.</li>
              <li>단지 기본정보(세대수, 준공년월, 용적률, 건폐율, 주차대수 등)는 건축물대장 등 공공데이터 및 자동화된 조사를
                기반으로 하며, 실제와 다를 수 있습니다. 중요한 의사결정 전에는 반드시 관리사무소, 등기부등본 등 원본 자료로
                재확인하시기 바랍니다.</li>
              <li>AI 검색·브리핑 기능이 제공하는 문장은 실제 조회된 데이터를 요약한 것이나, 인공지능 모델의 특성상 오류나
                누락이 발생할 수 있습니다.</li>
              <li>운영자는 이용자가 서비스에서 제공하는 정보를 신뢰하여 행한 거래·투자 등의 결과에 대해 법률상 책임을 지지
                않습니다.</li>
              <li>천재지변, 외부 공공데이터·API 제공기관의 장애 등 운영자가 통제할 수 없는 사유로 서비스 제공이 일시
                중단될 수 있으며, 이 경우 책임이 면제됩니다.</li>
            </ul>
          </div>

          <div className={styles.section}>
            <h2>제5조 (지식재산권)</h2>
            <p>
              서비스 화면의 구성, 디자인, UI, 편집물에 대한 저작권은 운영자에게 있습니다. 다만 원 데이터(국토교통부 실거래가,
              건축물대장 등 공공데이터)의 저작권은 각 데이터 제공기관에 있으며, 서비스는 이를 「공공데이터의 제공 및 이용
              활성화에 관한 법률」에 따라 가공하여 제공합니다. 이용자가 커뮤니티에 작성한 게시물의 저작권은 작성자 본인에게
              있으며, 운영자는 서비스 운영 목적 범위 내에서 이를 사용할 수 있습니다.
            </p>
          </div>

          <div className={styles.section}>
            <h2>제6조 (서비스의 변경 및 중단)</h2>
            <p>
              운영자는 운영상, 기술상 필요에 따라 제공하는 서비스의 전부 또는 일부를 변경하거나 중단할 수 있으며, 이 경우
              서비스 내 공지 등을 통해 사전에 안내함을 원칙으로 합니다. 다만 긴급한 경우 사후에 통지할 수 있습니다.
            </p>
          </div>

          <div className={styles.section}>
            <h2>제7조 (회원 탈퇴 및 이용 제한)</h2>
            <p>
              이용자는 언제든지 마이페이지를 통해 회원 탈퇴를 요청할 수 있습니다. 이용자가 이 약관 또는 관계 법령을 위반한
              경우, 운영자는 사전 통지 후(단, 긴급한 경우 사후 통지) 서비스 이용을 제한하거나 회원 자격을 정지·상실시킬 수
              있습니다.
            </p>
          </div>

          <div className={styles.section}>
            <h2>제8조 (분쟁 해결 및 준거법)</h2>
            <p>
              이 약관과 관련하여 발생한 분쟁에 대해서는 대한민국 법을 준거법으로 하며, 관할 법원은 민사소송법상의 관할
              법원으로 합니다.
            </p>
          </div>

          <div className={styles.section}>
            <h2>부칙</h2>
            <p>이 약관은 2026년 8월 11일부터 시행됩니다.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
