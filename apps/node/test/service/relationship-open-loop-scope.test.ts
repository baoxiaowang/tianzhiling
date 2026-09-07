import {
  getObjectDefinition,
  ScopeEnum,
} from '@midwayjs/core';
import { RelationshipOpenLoopService } from '../../src/service/agents/relationship-open-loop.service';

describe('RelationshipOpenLoopService lifecycle', () => {
  it('is process-scoped so its production interval cannot retain one request graph per resolution', () => {
    expect(getObjectDefinition(RelationshipOpenLoopService).scope).toBe(
      ScopeEnum.Singleton
    );
  });
});
