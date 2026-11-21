import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store } from './entities/store.entity';

@Injectable()
export class StoresService {
  constructor(
    @InjectRepository(Store)
    private readonly storeRepo: Repository<Store>,
  ) {}

  async findAll(): Promise<Store[]> {
    return this.storeRepo.find();
  }

  async findById(id: string): Promise<Store | null> {
    return this.storeRepo.findOne({ where: { id } });
  }

  async create(storeData: Partial<Store>): Promise<Store> {
    const store = this.storeRepo.create(storeData);
    return this.storeRepo.save(store);
  }
}
