const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * 검증 결과 모델 스키마
 */
const VerificationResultSchema = new Schema({
  // 검증된 주장 참조
  claim: {
    type: Schema.Types.ObjectId,
    ref: 'Claim',
    required: true
  },
  
  // 검증 상태
  status: {
    type: String,
    enum: ['VERIFIED_TRUE', 'VERIFIED_FALSE', 'PARTIALLY_TRUE', 'UNVERIFIED', 'DISPUTED'],
    required: true
  },
  
  // 신뢰도 점수 (0~1)
  trustScore: {
    type: Number,
    required: true,
    min: 0,
    max: 1
  },
  
  // 검증 설명
  explanation: {
    type: String,
    required: true
  },
  
  // 검증 소스 목록
  sources: [{
    name: {
      type: String,
      required: true
    },
    url: {
      type: String,
      required: true
    },
    credibility: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.7
    },
    excerpt: String,
    publishedDate: Date
  }],
  
  // 유형별 세부 검증 결과
  details: {
    factualAccuracy: {
      score: Number,
      explanation: String
    },
    sourceReliability: {
      score: Number,
      explanation: String
    },
    contextCompleteness: {
      score: Number,
      explanation: String
    }
  },
  
  // 검증 수행 방법
  verificationMethod: {
    type: String,
    enum: ['AI_ANALYSIS', 'DATABASE_LOOKUP', 'EXPERT_REVIEW', 'MULTI_SOURCE'],
    default: 'MULTI_SOURCE'
  },
  
  // 메타데이터
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  
  // 검증 수행 소요 시간 (ms)
  processingTime: {
    type: Number
  }
});

// 업데이트 시 updatedAt 필드 자동 갱신
VerificationResultSchema.pre('save', function(next) {
  if (this.isModified()) {
    this.updatedAt = Date.now();
  }
  next();
});

module.exports = mongoose.model('VerificationResult', VerificationResultSchema); 