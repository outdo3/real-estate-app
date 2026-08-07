import React, { useState, useEffect } from 'react';
import styles from './SearchFilterBar.module.css';

interface SearchFilterBarProps {
  initialLawdCd?: string;
  onRegionChange: (lawdCd: string, regionName: string, dongName?: string) => void;
  onSearch: (keyword: string) => void;
}

const SearchFilterBar: React.FC<SearchFilterBarProps> = ({
  initialLawdCd,
  onRegionChange,
  onSearch
}) => {
  const [sidos, setSidos] = useState<{code: string, name: string}[]>([]);
  const [sigungus, setSigungus] = useState<{code: string, name: string}[]>([]);
  const [dongs, setDongs] = useState<{code: string, name: string}[]>([]);

  const [sido, setSido] = useState<string>('');
  const [sigungu, setSigungu] = useState<string>('');
  const [dong, setDong] = useState<string>('all');
  const [keyword, setKeyword] = useState<string>('');

  // 1. 시/도 목록 가져오기
  useEffect(() => {
    fetch('https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes?regcode_pattern=*00000000')
      .then(res => res.json())
      .then(data => {
        setSidos(data.regcodes || []);
        if (data.regcodes && data.regcodes.length > 0) {
          const initSido = (initialLawdCd && initialLawdCd.length >= 2) ? initialLawdCd.substring(0, 2) : data.regcodes[0].code.substring(0, 2);
          setSido(initSido);
        }
      })
      .catch(console.error);
  }, [initialLawdCd]);

  // 2. 시도 변경 시 시군구 가져오기
  useEffect(() => {
    if (!sido) return;
    fetch(`https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes?regcode_pattern=${sido}*00000&is_ignore_zero=true`)
      .then(res => res.json())
      .then(data => {
        // 시도 자체 코드는 제외
        const list = (data.regcodes || []).filter((item: any) => item.code.substring(0, 5) !== `${sido}000`);
        setSigungus(list);
        
        if (list.length > 0) {
          let targetSigungu = list[0].code.substring(0, 5);
          if (initialLawdCd && initialLawdCd.startsWith(sido) && list.some((l: any) => l.code.startsWith(initialLawdCd))) {
            targetSigungu = initialLawdCd;
          }
          setSigungu(targetSigungu);
        } else {
          setSigungu('');
          setDongs([]);
        }
      })
      .catch(console.error);
  }, [sido, initialLawdCd]);

  // 3. 시군구 변경 시 읍면동 가져오기
  useEffect(() => {
    if (!sigungu) {
      setDongs([]);
      return;
    }
    fetch(`https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes?regcode_pattern=${sigungu}*&is_ignore_zero=true`)
      .then(res => res.json())
      .then(data => {
        // 시군구 자체 코드는 제외하고 읍면동만
        const list = (data.regcodes || []).filter((item: any) => item.code !== `${sigungu}00000`);
        setDongs(list);
        setDong('all'); // 동은 항상 '전체'로 초기화
        
        // 시군구까지만 변경되었을 때 콜백 호출
        const sidoName = sidos.find(s => s.code.startsWith(sido))?.name || '';
        const sigunguName = sigungus.find(s => s.code.startsWith(sigungu))?.name.split(' ').slice(1).join(' ') || '';
        onRegionChange(sigungu, `${sidoName} ${sigunguName}`, 'all');
      })
      .catch(console.error);
  }, [sigungu]);

  const handleSidoChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSido(e.target.value);
  };

  const handleSigunguChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSigungu(e.target.value);
  };

  const handleDongChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newDong = e.target.value;
    setDong(newDong);
    
    const sidoName = sidos.find(s => s.code.startsWith(sido))?.name || '';
    const sigunguName = sigungus.find(s => s.code.startsWith(sigungu))?.name.split(' ').slice(1).join(' ') || '';
    
    let dongName = 'all';
    if (newDong !== 'all') {
      const fullDongName = dongs.find(d => d.code === newDong)?.name || '';
      dongName = fullDongName.split(' ').pop() || 'all'; // "서울특별시 강남구 역삼동" -> "역삼동"
    }
    
    onRegionChange(sigungu, `${sidoName} ${sigunguName}`, dongName);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSearch(keyword);
    }
  };

  return (
    <div className={styles.heroSection}>
      <h1 className={styles.heroTitle}>아파트 실거래가의 모든 것</h1>
      <p className={styles.heroSubtitle}>관심 있는 지역이나 단지명을 검색해 보세요</p>

      <div className={styles.regionSelectGroup}>
        <select className={styles.selectBox} value={sido} onChange={handleSidoChange}>
          {sidos.map(item => (
            <option key={item.code} value={item.code.substring(0, 2)}>{item.name}</option>
          ))}
        </select>

        <select className={styles.selectBox} value={sigungu} onChange={handleSigunguChange}>
          {sigungus.map(item => {
            const nameParts = item.name.split(' ');
            const displayName = nameParts.slice(1).join(' ');
            return (
              <option key={item.code} value={item.code.substring(0, 5)}>{displayName}</option>
            );
          })}
        </select>

        <select className={styles.selectBox} value={dong} onChange={handleDongChange}>
          <option value="all">동 전체</option>
          {dongs.map(item => {
            const displayName = item.name.split(' ').pop();
            return (
              <option key={item.code} value={item.code}>{displayName}</option>
            );
          })}
        </select>
      </div>

      <div className={styles.searchContainer}>
        <input 
          type="text" 
          className={styles.searchInput} 
          placeholder="단지명, 지역명, 역명을 입력하세요" 
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={handleSearchKeyDown}
        />
        <button className={styles.searchBtn} onClick={() => onSearch(keyword)}>검색</button>
      </div>

    </div>
  );
};

export default SearchFilterBar;
