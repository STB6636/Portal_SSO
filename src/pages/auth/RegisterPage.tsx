import { Link } from 'react-router-dom';
import { useSettings } from '@/contexts/SettingsContext';

export default function RegisterPage() {
  const { settings } = useSettings();

  return (
    <div className="login-vertical-gradient min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        <div className="login-card-header-gradient px-6 py-5 text-center text-white">
          <i className="fa-solid fa-user-plus text-2xl text-[#F6DE51] mb-2" />
          <h1 className="text-lg font-extrabold">ลงทะเบียนบัญชีผู้ใช้งาน</h1>
        </div>
        <div className="p-6 text-center space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {settings.allow_self_register
              ? 'กรุณาติดต่อผู้ดูแลระบบประจำสำนักงาน/กอง หรือส่วน/ฝ่ายของคุณเพื่อรับ Register Ticket สำหรับยืนยันตัวตน'
              : 'ระบบกำหนดให้สร้างบัญชีผู้ใช้งานโดยอัตโนมัติจากทะเบียนประวัติบุคลากรโดยผู้ดูแลสังกัด (Username = CID, รหัสเริ่มต้น = CID 6 หลักท้าย)'}
          </p>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#00744B] text-white text-sm font-bold"
          >
            <i className="fa-solid fa-arrow-left" />
            กลับหน้าเข้าสู่ระบบ
          </Link>
        </div>
      </div>
    </div>
  );
}
