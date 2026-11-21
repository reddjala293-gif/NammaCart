import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
  ) {}

  async findAll(): Promise<Product[]> {
    return this.productRepo.find();
  }

  async findById(id: string): Promise<Product | null> {
    return this.productRepo.findOne({ where: { id } });
  }

  async create(data: Partial<Product>): Promise<Product> {
    const product = this.productRepo.create(data);
    return this.productRepo.save(product);
  }
}
