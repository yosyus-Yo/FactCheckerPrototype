/**
 * 뉴스 검증 결과를 저장하는 Verification 모델
 */
const mongoose = require('mongoose');

// VerificationSchema 정의
const VerificationSchema = new mongoose.Schema({
  claimId: {
    type: String,
    required: true,
    unique: true
  },
  claim: {
    text: String,
    url: String,
    title: String,
    content: String, // 크롤링된 원본 콘텐츠 저장
    extractionMethod: String // 콘텐츠 추출 방법 (playwright, cheerio 등)
  },
  truthScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 50
  },
  verdict: {
    type: String,
    enum: ['TRUE', 'LIKELY_TRUE', 'UNCERTAIN', 'LIKELY_FALSE', 'FALSE', 'NO_CLAIMS', '사실', '부분적 사실', '확인불가', '허위'],
    default: 'UNCERTAIN'
  },
  sources: [{
    title: String,
    url: String,
    score: Number
  }],
  processingTime: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// 로컬 메모리 데이터베이스 (MongoDB가 없을 때 사용)
const memoryDb = {
  verifications: new Map(),
  counter: 0
};

// MongoDB 연결 확인
const isMongoConnected = () => {
  return mongoose.connection.readyState === 1;
};

// 모델 생성 (MongoDB가 연결된 경우)
let Verification;

try {
  Verification = mongoose.model('Verification', VerificationSchema);
} catch (e) {
  if (e.name === 'OverwriteModelError') {
    Verification = mongoose.model('Verification');
  } else {
    console.error('Verification 모델 로드 오류:', e);
    // 오류 발생 시 더미 모델 생성
    Verification = {
      findOne: () => {
        console.warn('MongoDB 연결 없이 Verification.findOne() 호출됨.');
        return {
          sort: () => ({
            exec: () => Promise.resolve(null)
          })
        };
      },
      find: () => {
        console.warn('MongoDB 연결 없이 Verification.find() 호출됨.');
        return {
          sort: () => ({
            exec: () => Promise.resolve([])
          })
        };
      },
      save: (data) => {
        console.warn('MongoDB 연결 없이 Verification.save() 호출됨. 메모리 DB에 저장합니다.');
        return saveToMemoryDb(data);
      }
    };
  }
}

// 원본 findOne 메서드
const originalFindOne = Verification.findOne;

// findOne 메서드 재정의
Verification.findOne = function(query) {
  console.log('Verification.findOne 호출됨:', JSON.stringify(query));
  
  if (isMongoConnected()) {
    // MongoDB가 연결된 경우 원래 메서드 사용
    try {
      const result = originalFindOne.apply(this, arguments);
      return result;
    } catch (error) {
      console.error('MongoDB findOne 오류:', error);
      // 오류 시 메모리 데이터베이스 대체
      return findInMemoryDb(query);
    }
  } else {
    // MongoDB가 연결되지 않은 경우 메모리 데이터베이스 사용
    console.warn('MongoDB 연결 없이 findOne 호출됨. 메모리 DB에서 검색합니다.');
    return findInMemoryDb(query);
  }
};

// 메모리 데이터베이스에서 검색
function findInMemoryDb(query) {
  console.log('메모리 DB에서 검색:', JSON.stringify(query));
  
  // 결과를 저장할 변수
  let result = null;
  
  // Map에서 검색
  for (const [_, verification] of memoryDb.verifications) {
    let matches = true;
    
    // 모든 쿼리 키 확인
    for (const key in query) {
      if (Object.prototype.hasOwnProperty.call(query, key)) {
        const queryValue = query[key];
        
        // 중첩 키 처리 (예: claim.title)
        if (key.includes('.')) {
          const parts = key.split('.');
          let value = verification;
          
          // 중첩 객체 탐색
          for (const part of parts) {
            if (value && Object.prototype.hasOwnProperty.call(value, part)) {
              value = value[part];
            } else {
              value = undefined;
              break;
            }
          }
          
          // 정규식 쿼리 처리
          if (queryValue instanceof Object && queryValue.$regex) {
            if (!value || !queryValue.$regex.test(value)) {
              matches = false;
              break;
            }
          } 
          // 문자열 부분 일치
          else if (typeof value === 'string' && typeof queryValue === 'string') {
            if (!value.includes(queryValue)) {
              matches = false;
              break;
            }
          }
          // 정확히 일치
          else if (value !== queryValue) {
            matches = false;
            break;
          }
        } 
        // 일반 키 처리
        else {
          if (verification[key] !== queryValue) {
            matches = false;
            break;
          }
        }
      }
    }
    
    // 일치하는 항목 발견
    if (matches) {
      result = { ...verification };
      break;
    }
  }
  
  // MongoDB와 호환되는 인터페이스 제공
  const mockQuery = {
    sort: () => mockQuery,
    exec: () => Promise.resolve(result),
    then: (callback) => Promise.resolve(result).then(callback),
    catch: (callback) => Promise.resolve(result).catch(callback)
  };
  
  return mockQuery;
}

// 메모리 데이터베이스에 저장
function saveToMemoryDb(data) {
  const id = data.claimId || `mem-claim-${memoryDb.counter++}`;
  const verification = {
    ...data,
    claimId: id,
    createdAt: data.createdAt || new Date()
  };
  
  memoryDb.verifications.set(id, verification);
  console.log(`메모리 DB에 저장됨: ${id}`);
  
  return Promise.resolve(verification);
}

// 메모리 데이터베이스에서 모든 검증 결과 가져오기
function getAllFromMemoryDb() {
  return Array.from(memoryDb.verifications.values());
}

// save 메서드 재정의
Verification.save = async function(data) {
  if (isMongoConnected()) {
    try {
      const verification = new Verification(data);
      return await verification.save();
    } catch (error) {
      console.error('MongoDB 저장 오류:', error);
      // 오류 시 메모리 데이터베이스에 저장
      return saveToMemoryDb(data);
    }
  } else {
    console.warn('MongoDB 연결 없이 저장 시도. 메모리 DB에 저장합니다.');
    return saveToMemoryDb(data);
  }
};

module.exports = {
  Verification,
  VerificationSchema,
  isMongoConnected
}; 