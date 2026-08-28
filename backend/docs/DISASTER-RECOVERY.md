# Disaster Recovery & Business Continuity Plan

## 1. Backup Strategy
- **PostgreSQL 16**: Automated daily snapshot dumps stored on encrypted offline storage.
- **MinIO S3**: Object versioning and asynchronous cross-node bucket replication.
- **Proxmox Hypervisor**: Proxmox Backup Server (PBS) nightly VM image snapshots for VMs 101–105, 201–204, 301.

---

## 2. Recovery Procedures

### Restoring PostgreSQL Database
```bash
# Drop and restore from snapshot
dropdb -h 192.168.1.22 -U greenwave_prod greenwave_prod
createdb -h 192.168.1.22 -U greenwave_prod greenwave_prod
psql -h 192.168.1.22 -U greenwave_prod -d greenwave_prod < backup_file.sql
```

### Proxmox VM Disaster Recovery
1. Open Proxmox VE web interface (`https://192.168.1.84:8006` or `https://192.168.1.176:8006`).
2. Select target storage pool (`vmdata`).
3. Click **Restore** on the latest validated backup snapshot.
4. Verify network bridge assignment (`vmbr0`) and static IP allocation before booting VM.
