import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { User } from './entities/user.entity';

const BCRYPT_ROUNDS = 12;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async create(userData: {
    fullName: string;
    email: string;
    password: string;
    role?: string;
  }): Promise<User> {
    const email = normalizeEmail(userData.email);
    const existing = await this.usersRepository.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    // Callers that already hash (AuthService.register) pass a bcrypt hash
    // through; this guards direct callers (e.g. admin-created users) that
    // pass a plaintext password.
    const isAlreadyHashed = userData.password.startsWith('$2');
    const password = isAlreadyHashed
      ? userData.password
      : await bcrypt.hash(userData.password, BCRYPT_ROUNDS);

    const user = this.usersRepository.create({
      fullName: userData.fullName,
      email,
      password,
      role: userData.role ?? 'staff',
    });

    return this.usersRepository.save(user);
  }

  async count(): Promise<number> {
    return this.usersRepository.count();
  }

  async findAll(): Promise<User[]> {
    return this.usersRepository.find();
  }

  async findOne(id: number): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { id },
    });
  }

  /**
   * Returns the password hash too — used only by AuthService for the
   * bcrypt.compare step. Never expose this result over the API directly.
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email: normalizeEmail(email) })
      .getOne();
  }

  async update(
    id: number,
    updates: Partial<Pick<User, 'fullName' | 'email' | 'role'>>,
  ): Promise<User | null> {
    const patch = { ...updates };
    if (patch.email) {
      patch.email = normalizeEmail(patch.email);
    }
    await this.usersRepository.update(id, patch);
    return this.findOne(id);
  }
}
