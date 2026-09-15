/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { Readable } from 'stream';

import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';

describe('PhotosController', () => {
  let controller: PhotosController;
  let photosService: {
    getPhotoStream: jest.Mock;
    list: jest.Mock;
    findOneAuthorized: jest.Mock;
    toDto: jest.Mock;
  };

  const staffActor: AuthenticatedUser = {
    id: 1,
    role: 'staff',
    email: 'staff@example.com',
    fullName: 'Staff',
  };

  const createMockRes = () => {
    const headers: Record<string, string> = {};
    const res = {
      headers,
      setHeader: jest.fn((k: string, v: string) => {
        headers[k.toLowerCase()] = v;
      }),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      headersSent: false,
      write: jest.fn(),
      end: jest.fn(),
      emit: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
    } as unknown as Response;
    return res;
  };

  beforeEach(async () => {
    photosService = {
      getPhotoStream: jest.fn(),
      list: jest.fn(),
      findOneAuthorized: jest.fn(),
      toDto: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PhotosController],
      providers: [
        {
          provide: PhotosService,
          useValue: photosService,
        },
      ],
    }).compile();

    controller = module.get<PhotosController>(PhotosController);
  });

  describe('GET :id/view', () => {
    it('sets Content-Type and Cache-Control headers and pipes stream', async () => {
      const mockStream = new Readable({
        read() {
          this.push(null);
        },
      });
      const pipeSpy = jest.spyOn(mockStream, 'pipe');
      const res = createMockRes();

      photosService.getPhotoStream.mockResolvedValue({
        stream: mockStream,
        photo: {
          id: 'p-1',
          mimeType: 'image/jpeg',
          sizeBytes: 1234,
        },
        stat: { size: 1234 },
      });

      await controller.view('p-1', staffActor, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Length', '1234');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'private, no-cache, no-store, must-revalidate',
      );
      expect(pipeSpy).toHaveBeenCalledWith(res);
    });
  });

  describe('GET :id/thumbnail', () => {
    it('sets appropriate headers and generates thumbnail stream', async () => {
      const mockStream = new Readable({
        read() {
          this.push(null);
        },
      });
      const res = createMockRes();

      photosService.getPhotoStream.mockResolvedValue({
        stream: mockStream,
        photo: {
          id: 'p-1',
          mimeType: 'image/jpeg',
          sizeBytes: 5000,
        },
        stat: { size: 5000 },
      });

      await controller.thumbnail('p-1', staffActor, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'private, no-cache, no-store, must-revalidate',
      );
    });
  });

  describe('GET :id/download', () => {
    it('sets Content-Disposition attachment header and Content-Type', async () => {
      const mockStream = new Readable({
        read() {
          this.push(null);
        },
      });
      const pipeSpy = jest.spyOn(mockStream, 'pipe');
      const res = createMockRes();

      photosService.getPhotoStream.mockResolvedValue({
        stream: mockStream,
        photo: {
          id: 'p-1',
          mimeType: 'image/png',
          originalFilename: 'custom-seal.png',
          sizeBytes: 4096,
        },
        stat: { size: 4096 },
      });

      await controller.download('p-1', staffActor, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('attachment; filename="custom-seal.png"'),
      );
      expect(pipeSpy).toHaveBeenCalledWith(res);
    });
  });
});
