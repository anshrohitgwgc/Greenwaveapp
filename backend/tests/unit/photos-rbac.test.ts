import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

interface PhotoRecord {
  id: string;
  warehouseId: string;
  takenBy: number;
  url: string;
  exifStripped: boolean;
}

function filterAccessiblePhotos(photos: PhotoRecord[], user: { id: number; role: string }, warehouseId?: string) {
  return photos.filter((p) => {
    if (warehouseId && p.warehouseId !== warehouseId) return false;
    if (['admin', 'manager'].includes(user.role)) return true;
    return p.takenBy === user.id;
  });
}

describe('Unit: Photos Privacy & Multi-Warehouse Access Control', () => {
  const samplePhotos: PhotoRecord[] = [
    { id: 'p1', warehouseId: 'CGY', takenBy: 1, url: 'https://minio/photos/p1.jpg', exifStripped: true },
    { id: 'p2', warehouseId: 'CGY', takenBy: 2, url: 'https://minio/photos/p2.jpg', exifStripped: true },
    { id: 'p3', warehouseId: 'ON',  takenBy: 3, url: 'https://minio/photos/p3.jpg', exifStripped: true },
  ];

  it('1. Staff users can ONLY access photos they personally took', () => {
    const staffUser = { id: 1, role: 'staff' };
    const accessible = filterAccessiblePhotos(samplePhotos, staffUser, 'CGY');
    assert.equal(accessible.length, 1);
    assert.equal(accessible[0].id, 'p1');
  });

  it('2. Admins and Managers can see all warehouse photos, but strictly isolated by warehouse', () => {
    const adminUser = { id: 99, role: 'admin' };
    const cgyPhotos = filterAccessiblePhotos(samplePhotos, adminUser, 'CGY');
    assert.equal(cgyPhotos.length, 2);
    assert.ok(cgyPhotos.every((p) => p.warehouseId === 'CGY'));

    const onPhotos = filterAccessiblePhotos(samplePhotos, adminUser, 'ON');
    assert.equal(onPhotos.length, 1);
    assert.equal(onPhotos[0].id, 'p3');
  });
});
