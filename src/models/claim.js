const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * 주장(Claim) 모델 스키마
 */
const ClaimSchema = new Schema({
  // 주장 원문
  text: {
    type: String,
    required: true,
    trim: true
  },
  
  // 주장이 발견된 콘텐츠 소스 정보
  source: {
    type: {
      type: String,
      enum: ['VIDEO', 'AUDIO', 'TEXT', 'IMAGE'],
      required: true
    },
    url: String,
    title: String,
    timestamp: Number // 비디오/오디오인 경우 발견된 시간(초)
  },
  
  // 주장 감지 신뢰도 (0~1)
  confidence: {
    type: Number,
    required: true,
    min: 0,
    max: 1
  },
  
  // 주장 카테고리
  category: {
    type: String,
    enum: ['정치', '경제', '사회', '문화', '과학', '스포츠', '기타'],
    default: '기타'
  },
  
  // 검증 결과
  verification: {
    status: {
      type: String,
      enum: ['VERIFIED_TRUE', 'VERIFIED_FALSE', 'PARTIALLY_TRUE', 'UNVERIFIED', 'DISPUTED'],
      default: 'UNVERIFIED'
    },
    trustScore: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5
    },
    explanation: String,
    sources: [{
      name: String,
      url: String,
      credibility: Number // 소스 신뢰도 (0~1)
    }]
  },
  
  // 메타데이터
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// 업데이트 시 updatedAt 필드 자동 갱신
ClaimSchema.pre('save', function(next) {
  if (this.isModified()) {
    this.updatedAt = Date.now();
  }
  next();
});

module.exports = mongoose.model('Claim', ClaimSchema); 