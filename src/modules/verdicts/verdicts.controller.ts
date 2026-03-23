import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { VerdictsService } from './verdicts.service';

@ApiTags('verdicts')
@Controller('verdicts')
export class VerdictsController {
  constructor(private readonly verdictsService: VerdictsService) {}

  @Get(':sessionId')
  @ApiOperation({ summary: 'Get verdict by session ID' })
  findBySessionId(@Param('sessionId') sessionId: string) {
    return this.verdictsService.findBySessionId(sessionId);
  }

  @Get()
  @ApiOperation({ summary: 'List all verdicts' })
  findAll() {
    return this.verdictsService.findAll();
  }
}
