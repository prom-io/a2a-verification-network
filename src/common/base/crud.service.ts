import { Logger, NotFoundException } from '@nestjs/common';
import { DeepPartial, FindOptionsWhere, ObjectLiteral, Repository } from 'typeorm';
import { PaginationDto } from '../dto/pagination.dto';

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export abstract class CrudService<T extends ObjectLiteral & { id: string }> {
  protected abstract readonly repo: Repository<T>;
  protected readonly logger: Logger;

  constructor(private readonly entityName: string) {
    this.logger = new Logger(`${entityName}Service`);
  }

  async create(data: DeepPartial<T>): Promise<T> {
    const entity = this.repo.create(data);
    const saved = await this.repo.save(entity);
    this.logger.log(`${this.entityName} created: ${saved.id}`);
    return saved;
  }

  async findAll(pagination?: PaginationDto): Promise<Paginated<T>> {
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;
    const [items, total] = await this.repo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' } as unknown as never,
    });
    return { items, total, page, limit };
  }

  async findById(id: string): Promise<T> {
    const entity = await this.repo.findOneBy({ id } as FindOptionsWhere<T>);
    if (!entity) throw new NotFoundException(`${this.entityName} ${id} not found`);
    return entity;
  }

  async update(id: string, data: DeepPartial<T>): Promise<T> {
    const entity = await this.findById(id);
    Object.assign(entity, data);
    const saved = await this.repo.save(entity);
    this.logger.log(`${this.entityName} updated: ${id}`);
    return saved;
  }

  async remove(id: string): Promise<void> {
    const entity = await this.findById(id);
    await this.repo.remove(entity);
    this.logger.log(`${this.entityName} removed: ${id}`);
  }
}
