import {
  ACTIVE_TEACHER_PROFILE,
  TEACHER_ACTIONS_BY_PROFILE,
  TEACHER_CONTRACT_PROFILES,
  getTeacherContractMetadata,
} from './teacher';

describe('teacher contract profiles', () => {
  it('keeps template24 and fairy48 profiles available', () => {
    expect(TEACHER_CONTRACT_PROFILES).toEqual(['template24', 'fairy48']);
  });

  it('exposes expected action inventory counts', () => {
    expect(TEACHER_ACTIONS_BY_PROFILE.template24).toHaveLength(24);
    expect(TEACHER_ACTIONS_BY_PROFILE.fairy48).toHaveLength(48);
  });

  it('returns profile-aware metadata', () => {
    expect(getTeacherContractMetadata('template24')).toMatchObject({
      profile: 'template24',
      actionCount: 24,
    });
    expect(getTeacherContractMetadata('fairy48')).toMatchObject({
      profile: 'fairy48',
      actionCount: 48,
    });
    expect(['template24', 'fairy48']).toContain(ACTIVE_TEACHER_PROFILE);
  });
});
