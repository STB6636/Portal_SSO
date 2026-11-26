import { AdminLayout } from '@/components/layout/AdminLayout';
import { MyProfileContent } from '@/components/profile/MyProfileModal';

export default function ProfilePage() {
  return (
    <AdminLayout
      title="โปรไฟล์ของฉัน"
      subtitle="ข้อมูลส่วนตัว ประวัติรับราชการ (ก.พ. ๗) รูปโปรไฟล์ ไฟล์ลายเซ็น และการเปลี่ยนรหัสเข้าใช้"
      activePage="profile"
    >
      <div className="max-w-4xl mx-auto">
        <MyProfileContent />
      </div>
    </AdminLayout>
  );
}
