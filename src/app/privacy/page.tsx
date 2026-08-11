import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import Header from '@/components/Header';
import styles from '../terms/legal.module.css';

export const metadata: Metadata = {
  title: `개인정보처리방침 - ${siteConfig.name}`,
  description: `${siteConfig.name} 개인정보처리방침 및 위치정보 이용약관입니다.`,
  openGraph: buildOpenGraph({
    title: `개인정보처리방침 - ${siteConfig.name}`,
    description: `${siteConfig.name} 개인정보처리방침 및 위치정보 이용약관입니다.`,
  }),
};

export default function PrivacyPage() {
  return (
    <div className={styles.main}>
      <Header pageTitle="개인정보처리방침" />
      <div className="container">
        <div className={styles.content}>
          <p className={styles.updatedAt}>시행일자: 2026년 8월 11일</p>

          <div className={styles.section}>
            <p>
              개인 서비스 운영자(사업자등록 없이 운영되는 개인 서비스, 이하 &ldquo;운영자&rdquo;)가 제공하는 &ldquo;{siteConfig.name}&rdquo;
              (이하 &ldquo;서비스&rdquo;)는 이용자의 개인정보를 중요시하며, 「개인정보 보호법」 등 관계 법령을 준수하기 위해
              노력합니다. 본 방침은 서비스가 어떤 개인정보를 수집하고, 어떻게 이용·보관하며, 이용자가 어떤 권리를 행사할 수
              있는지 안내합니다.
            </p>
          </div>

          <div className={styles.section}>
            <h2>1. 수집하는 개인정보 항목</h2>
            <h3>가. 소셜 로그인(카카오, 네이버) 시</h3>
            <ul>
              <li>필수: 닉네임(이름), 이메일 주소, 프로필 이미지, 각 소셜 플랫폼이 부여하는 고유 식별자(ID)</li>
            </ul>
            <h3>나. 서비스 이용 과정에서 자동 수집되는 정보</h3>
            <ul>
              <li>기기정보(브라우저 종류, OS), 접속 IP, 쿠키, 서비스 이용 기록(방문 일시, 검색어)</li>
              <li>위치정보: 이용자가 &ldquo;내 위치&rdquo; 기능을 사용하거나 위치 접근을 허용한 경우에 한해 GPS 또는
                IP 기반 대략적 위치</li>
            </ul>
            <h3>다. 커뮤니티 이용 시</h3>
            <ul>
              <li>게시물·댓글의 작성 내용, 작성 일시</li>
            </ul>
          </div>

          <div className={styles.section}>
            <h2>2. 개인정보의 수집 및 이용 목적</h2>
            <ul>
              <li>회원 식별 및 로그인 유지, 부정 이용 방지</li>
              <li>커뮤니티 게시물 작성자 표시 및 게시물 관리</li>
              <li>&ldquo;내 위치&rdquo; 기반 주변 아파트·학교 검색 등 위치기반 서비스 제공</li>
              <li>AI 검색 기능의 질의 처리 및 응답 품질 개선</li>
              <li>서비스 오류 대응, 문의 처리</li>
            </ul>
          </div>

          <div className={styles.section}>
            <h2>3. 개인정보의 보유 및 이용기간</h2>
            <p>
              원칙적으로 이용자가 회원 탈퇴를 요청하거나 수집·이용 목적이 달성된 경우 지체 없이 파기합니다. 다만 관계 법령에
              따라 보존할 필요가 있는 경우 해당 법령이 정한 기간 동안 보관합니다.
            </p>
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>보관 항목</th>
                    <th>보관 기간</th>
                    <th>근거</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>회원 가입정보</td>
                    <td>회원 탈퇴 시까지</td>
                    <td>서비스 이용계약 유지</td>
                  </tr>
                  <tr>
                    <td>커뮤니티 게시물</td>
                    <td>이용자가 삭제하거나 탈퇴 시까지</td>
                    <td>게시물 관리</td>
                  </tr>
                  <tr>
                    <td>서비스 이용기록(로그)</td>
                    <td>최대 3개월</td>
                    <td>통신비밀보호법</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className={styles.section}>
            <h2>4. 개인정보의 제3자 제공</h2>
            <p>
              운영자는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다. 다만 다음의 경우는 예외로 합니다.
            </p>
            <ul>
              <li>이용자가 사전에 동의한 경우</li>
              <li>법령의 규정에 의거하거나, 수사 목적으로 법령에 정해진 절차와 방법에 따라 수사기관의 요구가 있는 경우</li>
            </ul>
          </div>

          <div className={styles.section}>
            <h2>5. 개인정보 처리의 위탁</h2>
            <p>
              서비스는 안정적인 운영을 위해 아래와 같이 개인정보 처리 업무를 외부 업체에 위탁하고 있습니다.
            </p>
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>수탁업체</th>
                    <th>위탁 업무 내용</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Supabase (Supabase, Inc.)</td>
                    <td>회원정보·게시물 등 데이터베이스 호스팅</td>
                  </tr>
                  <tr>
                    <td>Vercel Inc.</td>
                    <td>서비스(웹사이트) 호스팅 및 배포</td>
                  </tr>
                  <tr>
                    <td>카카오, 네이버</td>
                    <td>소셜 로그인 인증</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className={styles.section}>
            <h2>6. 이용자의 권리와 행사방법</h2>
            <p>
              이용자는 언제든지 등록되어 있는 자신의 개인정보를 조회하거나 수정할 수 있으며, 마이페이지를 통해 회원 탈퇴
              (개인정보 삭제 요청)를 할 수 있습니다. 아래 연락처를 통해 개인정보 열람, 정정, 삭제, 처리정지를 요청할 수도
              있습니다.
            </p>
          </div>

          <div className={styles.section}>
            <h2>7. 쿠키(Cookie)의 운영 및 광고 서비스</h2>
            <p>
              서비스는 이용자에게 최적화된 정보를 제공하기 위해 쿠키를 사용할 수 있습니다. 이용자는 웹브라우저 설정을 통해
              쿠키 저장을 거부할 수 있으나, 이 경우 일부 서비스 이용에 제약이 있을 수 있습니다.
            </p>
            <p>
              구글을 비롯한 제3자 광고 서비스 제공업체는 쿠키를 사용하여 이용자가 웹사이트 또는 다른 웹사이트를 방문한 정보를
              기반으로 광고를 게재할 수 있습니다. 구글의 광고 쿠키 사용으로 인해 구글과 구글의 파트너는 서비스 및 인터넷의
              다른 사이트 방문 정보를 토대로 이용자에게 적절한 광고를 제공할 수 있습니다. 이용자는{' '}
              <a href="https://adssettings.google.com/" target="_blank" rel="noopener noreferrer">
                Google 광고 설정
              </a>{' '}
              페이지에서 맞춤 광고를 비활성화할 수 있습니다.
            </p>
          </div>

          <div className={styles.section}>
            <h2>8. 위치정보 이용약관</h2>
            <p>서비스는 지도 기반 단지 검색, 주변 학교·시설 검색 등의 기능을 위해 위치정보를 이용합니다.</p>
            <ul>
              <li>위치정보는 이용자가 브라우저의 위치 접근 권한을 허용한 경우에만 수집되며, 거부하더라도 지역 검색 등
                대체 수단으로 서비스를 계속 이용할 수 있습니다.</li>
              <li>수집된 위치정보는 지도 중심 이동, 주변 아파트·학교 검색 결과 표시 목적에만 이용되며, 별도로 저장하지
                않고 해당 요청 처리 후 즉시 파기합니다.</li>
              <li>위치정보 처리는 카카오맵(Kakao Maps) API를 통해 이루어지며, 위치 좌표는 카카오의 위치 확인 서비스에도
                함께 전달됩니다.</li>
              <li>이용자는 언제든지 위치정보 수집에 대한 동의를 철회(브라우저 권한 재설정)할 수 있습니다.</li>
              <li>운영자는 위치정보의 안전한 처리를 위해 관련 법령(위치정보의 보호 및 이용 등에 관한 법률)을 준수합니다.</li>
            </ul>
          </div>

          <div className={styles.section}>
            <h2>9. 개인정보의 안전성 확보조치</h2>
            <ul>
              <li>개인정보에 대한 접근 권한을 최소한의 인원으로 제한하고 있습니다.</li>
              <li>회원 인증은 자체 비밀번호 저장 없이 소셜 로그인(OAuth) 방식만을 사용합니다.</li>
              <li>데이터베이스 및 호스팅 인프라는 암호화 전송(HTTPS)을 적용하고 있습니다.</li>
            </ul>
          </div>

          <div className={styles.section}>
            <h2>10. 개인정보 보호책임자</h2>
            <div className={styles.contactBox}>
              <p style={{ margin: 0 }}>
                서비스명: {siteConfig.name}
                <br />
                관리 책임자(개인 운영자): outdo1978@gmail.com
                <br />
                개인정보 관련 문의, 열람·정정·삭제 요청은 위 이메일로 접수해 주시면 지체 없이 처리하겠습니다.
              </p>
            </div>
          </div>

          <div className={styles.section}>
            <h2>11. 고지의 의무</h2>
            <p>
              현 개인정보처리방침의 내용이 추가, 삭제 및 수정이 있을 시에는 개정 최소 7일 전부터 서비스 내 공지사항을 통해
              고지할 것입니다. 다만 이용자 권리의 중대한 변경이 발생할 경우 최소 30일 전에 고지합니다.
            </p>
          </div>

          <div className={styles.section}>
            <h2>부칙</h2>
            <p>이 방침은 2026년 8월 11일부터 시행됩니다.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
