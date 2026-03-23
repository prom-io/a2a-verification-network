import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Validator } from './entities/validator.entity';
import { RegisterValidatorDto } from './dto/register-validator.dto';

@Injectable()
export class ValidatorsService {
  constructor(
    @InjectRepository(Validator)
    private readonly validatorRepo: Repository<Validator>,
  ) {}

  async register(dto: RegisterValidatorDto): Promise<Validator> {
    const validator = this.validatorRepo.create({
      address: dto.address,
      publicKey: dto.publicKey,
      stake: dto.stake,
      endpoint: dto.endpoint,
      capabilities: dto.capabilities ?? [],
    });
    return this.validatorRepo.save(validator);
  }

  async findAll(): Promise<Validator[]> {
    return this.validatorRepo.find();
  }

  async findOne(id: string): Promise<Validator> {
    const validator = await this.validatorRepo.findOneBy({ id });
    if (!validator) throw new NotFoundException(`Validator ${id} not found`);
    return validator;
  }

  async exit(id: string): Promise<Validator> {
    const validator = await this.findOne(id);
    validator.isActive = false;
    return this.validatorRepo.save(validator);
  }
}
