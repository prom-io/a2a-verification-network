import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DisputesService } from './disputes.service';
import { OpenDisputeDto } from './dto/open-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';

@ApiTags('disputes')
@Controller('disputes')
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Post()
  @ApiOperation({ summary: 'Open a new dispute against a verdict' })
  @ApiResponse({ status: 201, description: 'Dispute opened successfully' })
  open(@Body() dto: OpenDisputeDto) {
    return this.disputesService.open(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get dispute by ID' })
  @ApiResponse({ status: 404, description: 'Dispute not found' })
  findOne(@Param('id') id: string) {
    return this.disputesService.findOne(id);
  }

  @Patch(':id/resolve')
  @ApiOperation({ summary: 'Resolve an open dispute' })
  @ApiResponse({ status: 200, description: 'Dispute resolved' })
  resolve(@Param('id') id: string, @Body() dto: ResolveDisputeDto) {
    return this.disputesService.resolve(id, dto);
  }
}
