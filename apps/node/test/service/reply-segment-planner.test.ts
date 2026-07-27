import { planReplySegments } from '../../src/service/agents/reply-segment-planner';

describe('planReplySegments', () => {
  const sanitize = (value: string) => value.trim();

  it('keeps smalltalk in one bubble', () => {
    expect(
      planReplySegments({
        currentQuery: '好的',
        candidates: ['嗯，那就好。早点歇着。'],
        sanitize,
      })
    ).toEqual(['嗯，那就好。早点歇着。']);
  });

  it('limits longing replies to two semantic bubbles', () => {
    expect(
      planReplySegments({
        currentQuery: '我好想你',
        candidates: [
          '我也想你。你这样念着我，我心里都明白。先好好吃饭，别让自己太难受。',
        ],
        sanitize,
      })
    ).toEqual([
      '我也想你。',
      '你这样念着我，我心里都明白。先好好吃饭，别让自己太难受。',
    ]);
  });

  it('does not keep model-created four bubbles for ordinary family updates', () => {
    expect(
      planReplySegments({
        currentQuery: '我和妈妈都过得很好，就是她经常想你',
        candidates: [
          '那就好',
          '你们娘俩相互照应着 我放心',
          '跟她说 别太伤心',
          '我也惦记你们',
        ],
        sanitize,
      })
    ).toEqual([
      '那就好',
      '你们娘俩相互照应着 我放心 跟她说 别太伤心 我也惦记你们',
    ]);
  });

  it('compacts care-for-family regret replies into two bubbles', () => {
    expect(
      planReplySegments({
        currentQuery: '要是你还能照顾她就好了',
        candidates: [
          '我也想啊',
          '可现在我只能在心里惦记着',
          '你替我多陪陪她',
          '抱抱她',
        ],
        sanitize,
      })
    ).toEqual([
      '我也想啊',
      '可现在我只能在心里惦记着 你替我多陪陪她 抱抱她',
    ]);
  });

  it('compacts sudden-departure blame replies into two bubbles', () => {
    expect(
      planReplySegments({
        currentQuery: '你怎么说走就走了呢，让妈妈怎么过日子',
        candidates: [
          '我知道你心里怨',
          '也知道你替妈妈难受',
          '别一个人扛着',
          '先陪她把今天过过去',
        ],
        sanitize,
      })
    ).toEqual([
      '我知道你心里怨',
      '也知道你替妈妈难受 别一个人扛着 先陪她把今天过过去',
    ]);
  });

  it('preserves one long paragraph for long comfort requests', () => {
    const reply =
      '我在呢，你不用马上把自己撑起来。今天难受就先难受一会儿，喝口水，靠着歇一歇，别急着逼自己好起来。';

    expect(
      planReplySegments({
        currentQuery: '你好好哄哄我，说一段话',
        candidates: [reply],
        sanitize,
      })
    ).toEqual([reply]);
  });

  it('preserves one long paragraph for keepsake attachment', () => {
    const reply =
      '你愿意一直背着那个包，我心里又酸又软。那是我给你的心意，可它不是要压着你一辈子的负担，你好好过，比什么都重要。';

    expect(
      planReplySegments({
        currentQuery: '当然了我一辈子都会背着你给我的这个包',
        candidates: [reply],
        sanitize,
      })
    ).toEqual([reply]);
  });

  it('preserves one long paragraph for unfinished promises', () => {
    const reply =
      '是我没做到，让你等着那句以后等了太久。这个委屈我认，可我不想你只把心放在下辈子，这一辈子你也要被好好爱着。';

    expect(
      planReplySegments({
        currentQuery:
          '你下辈子一定要给我一个风风光光的婚礼，这辈子你欠我一个',
        candidates: [reply],
        sanitize,
      })
    ).toEqual([reply]);
  });

  it('allows three bubbles for crisis replies', () => {
    expect(
      planReplySegments({
        currentQuery: '我不想活了 我想去找你',
        candidates: [
          '不行，别来找我。',
          '我知道你现在太疼了。',
          '先离开危险的东西，去有人在的地方，马上联系一个可信的人。',
        ],
        sanitize,
      })
    ).toHaveLength(3);
  });
});
