import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib";

/**
 * Real club dataset — imported from the club's spreadsheet.
 * Sheets: inventory (working/broken per closet), projects + amounts,
 * members with roles, and the full loan history.
 *
 * Model mapping:
 *   Closets_Y (works, in closet)  -> part status "available"
 *   Closets_N (broken, in closet) -> part status "broken"
 *   Amount on Project             -> part status "on_project" + currentProjectId
 *   Loans "لم يتم الإرجاع بعد"     -> part status "rented" + active rental
 *   Loans "تم الإرجاع"             -> historical rental (status returned)
 */

type GroupSeed = {
  name: string;
  cat: string;
  closet: number;
  w: number;
  b?: number;
  prefix?: string;
  note?: string;
  aliases?: string[];
};

const CLOSETS = [
  { name: "Closet 1", location: "Lab — Wall 1" },
  { name: "Closet 2", location: "Lab — Wall 2" },
  { name: "Closet 3", location: "Lab A — sensors & boards" },
  { name: "Closet 4", location: "Lab A — misc" },
  { name: "Closet 5", location: "Lab A — tools & motors" },
  { name: "Closet 6", location: "Repair pile — broken units" },
  { name: "Closet 7", location: "Lab B — equipment" },
  { name: "Closet 8", location: "Lab B — cameras & media" },
];

const CATEGORIES = [
  "Sensors",
  "Equipments",
  "Boards",
  "Motors & Drivers",
  "Power",
  "Mechanical",
  "Camera & Vision",
  "Displays & IO",
  "Cables & Connectors",
  "Furnishings",
  "Kits",
];

const GROUPS: GroupSeed[] = [
  // ===== Sensors =====
  { name: "LDR", cat: "Sensors", closet: 5, w: 41, prefix: "LDR" },
  { name: "TCRT1000", cat: "Sensors", closet: 3, w: 32, prefix: "TCR1K" },
  { name: "Rotary-Encoder", cat: "Sensors", closet: 3, w: 9, b: 1, prefix: "ROTENC" },
  { name: "TCRT5500", cat: "Sensors", closet: 3, w: 19, b: 7, prefix: "TCR55" },
  { name: "RF-Sender", cat: "Sensors", closet: 5, w: 7, prefix: "RFS" },
  { name: "RF-Reciver", cat: "Sensors", closet: 5, w: 7, prefix: "RFR" },
  { name: "SD-Card Reader (Large)", cat: "Sensors", closet: 5, w: 1, prefix: "SDCRD" },
  { name: "Optical-Encoder", cat: "Sensors", closet: 3, w: 4, b: 5, prefix: "OPTENC" },
  { name: "Laser-Sensors (VL53LXX-V2)", cat: "Sensors", closet: 3, w: 4, prefix: "VL53" },
  { name: "MPU-9250", cat: "Sensors", closet: 3, w: 3, prefix: "MPU9" },
  { name: "Ultra-Sonic", cat: "Sensors", closet: 3, w: 1, b: 5, prefix: "ULTRA", aliases: ["Ultrasonic", "Ultra-Sonic Sensor"] },
  { name: "PIR", cat: "Sensors", closet: 3, w: 5, prefix: "PIR" },
  { name: "KeyPad", cat: "Sensors", closet: 3, w: 6, prefix: "KEY" },
  { name: "WEB-CAM (F/#2.0 F:4.8mm)", cat: "Sensors", closet: 8, w: 1, prefix: "WCAM1" },
  { name: "WEB-CAM (RAPOO 720p)", cat: "Sensors", closet: 8, w: 1, prefix: "WCAM2" },
  { name: "LM35", cat: "Sensors", closet: 3, w: 2, prefix: "LM35" },
  { name: "MPU-6050", cat: "Sensors", closet: 3, w: 5, prefix: "MPU6" },
  { name: "Optical Encoder (MH-Sensor-Series)", cat: "Sensors", closet: 5, w: 3, prefix: "OPT-MH" },
  { name: "RPLIDAR", cat: "Sensors", closet: 8, w: 1, prefix: "LIDAR" },
  { name: "Kinect Camera", cat: "Sensors", closet: 8, w: 2, prefix: "KINECT" },
  { name: "Raspberry Pi Camera", cat: "Sensors", closet: 8, w: 1, prefix: "PICAM" },
  { name: "Limit-Switch", cat: "Sensors", closet: 3, w: 3, prefix: "LIMIT" },
  // ===== Equipments =====
  { name: "بانسة أمبير", cat: "Equipments", closet: 7, w: 1, prefix: "AMPM" },
  { name: "مفكات شق كبيرة", cat: "Equipments", closet: 5, w: 4, prefix: "SCR-FL" },
  { name: "مفكات مصالب كبيرة", cat: "Equipments", closet: 5, w: 3, prefix: "SCR-PH" },
  { name: "مفكات مصالب صغيرة", cat: "Equipments", closet: 5, w: 3, prefix: "SCR-PS" },
  { name: "مفكات رؤوس منوعة", cat: "Equipments", closet: 5, w: 4, prefix: "SCR-MX" },
  { name: "مفكات سداسية", cat: "Equipments", closet: 5, w: 15, prefix: "SCR-HX" },
  { name: "علب مفكات متعددة الرؤوس", cat: "Equipments", closet: 5, w: 3, prefix: "SCR-BX" },
  { name: "فاحص كهربائي", cat: "Equipments", closet: 5, w: 2, prefix: "TESTER" },
  { name: "بانسات كبيرة", cat: "Equipments", closet: 5, w: 3, prefix: "PLR-B" },
  { name: "بانسات معقوفة", cat: "Equipments", closet: 5, w: 1, prefix: "PLR-C" },
  { name: "قطاعات كبيرة", cat: "Equipments", closet: 5, w: 2, prefix: "CUT" },
  { name: "مطرقة حديد", cat: "Equipments", closet: 5, w: 1, prefix: "HAMMER" },
  { name: "مبرد حديد", cat: "Equipments", closet: 5, w: 1, prefix: "FILE" },
  { name: "كاوي قصدير", cat: "Equipments", closet: 5, w: 1, prefix: "SOLD-IR", aliases: ["كاوي قصدير  "] },
  { name: "قاعدة كاوي قصدير", cat: "Equipments", closet: 5, w: 2, prefix: "SOLD-ST" },
  { name: "بكرة قصدير", cat: "Equipments", closet: 5, w: 1, prefix: "SOLDER" },
  { name: "منشار خشب كهربائي", cat: "Equipments", closet: 5, w: 1, prefix: "SAW" },
  { name: "Avometer", cat: "Equipments", closet: 5, w: 1, prefix: "AVO", aliases: ["Avometer  "] },
  // ===== Boards =====
  { name: "Arduino Uno", cat: "Boards", closet: 5, w: 12, prefix: "ARD-UNO" },
  { name: "Arduino Mega 2650", cat: "Boards", closet: 5, w: 8, prefix: "ARD-MEGA" },
  { name: "ESP32", cat: "Boards", closet: 5, w: 5, prefix: "ESP32" },
  { name: "ESP8266", cat: "Boards", closet: 5, w: 2, prefix: "ESP8266" },
  { name: "Raspberry Pi (4)", cat: "Boards", closet: 5, w: 4, prefix: "RPI4", aliases: ["Raspberry Pi 4"] },
  { name: "Jetson Nano", cat: "Boards", closet: 5, w: 1, prefix: "JETSON" },
  { name: "BeagleBone-Blue", cat: "Boards", closet: 5, w: 1, prefix: "BBB", aliases: ["BegalBone-Blue"] },
  { name: "WiFi Module", cat: "Boards", closet: 5, w: 2, prefix: "WIFI" },
  { name: "Pic-Programming Adapter", cat: "Boards", closet: 5, w: 1, prefix: "PIC-ADP" },
  { name: "Mini Bread-Board", cat: "Boards", closet: 3, w: 2, prefix: "BREAD" },
  // ===== Motors & Drivers =====
  { name: "DC-Motor with Encoder (JGA25-370)", cat: "Motors & Drivers", closet: 5, w: 10, prefix: "JGA25E", aliases: ["DC-Motor with Encoder (JGA25-370) "] },
  { name: "DC-Motor (JGA25-370)", cat: "Motors & Drivers", closet: 5, w: 4, prefix: "JGA25", aliases: ["DC-Motor (JGA25-370)"] },
  { name: "DC-Motor (TTL)", cat: "Motors & Drivers", closet: 5, w: 11, prefix: "TTL" },
  { name: "DC-Motor with Encoder (CHR-MG25-370)", cat: "Motors & Drivers", closet: 5, w: 1, prefix: "CHR25" },
  { name: "Stepper-Motor (NEMA 17)", cat: "Motors & Drivers", closet: 5, w: 8, prefix: "NEMA17" },
  { name: "Stepper-Motor (NEMA 23)", cat: "Motors & Drivers", closet: 5, w: 6, prefix: "NEMA23" },
  { name: "Stepper-Motor (NEMA 43)", cat: "Motors & Drivers", closet: 5, w: 1, prefix: "NEMA43", aliases: ["Stepper-Motor(NEMA 43)", "Stepper-Motor (NEMA43)"] },
  { name: "Stepper-Motor (28BYJ-48)", cat: "Motors & Drivers", closet: 5, w: 4, prefix: "28BYJ" },
  { name: "Servo (MG995)", cat: "Motors & Drivers", closet: 5, w: 10, prefix: "MG995" },
  { name: "Servo SG90", cat: "Motors & Drivers", closet: 5, w: 5, prefix: "SG90" },
  { name: "Servo-Horn (MG995)", cat: "Motors & Drivers", closet: 5, w: 5, prefix: "SERVOH" },
  { name: "L298N", cat: "Motors & Drivers", closet: 5, w: 8, prefix: "L298N", aliases: ["L298N  "] },
  { name: "TB6600", cat: "Motors & Drivers", closet: 5, w: 10, prefix: "TB6600", aliases: ["TB6600  "] },
  { name: "A4988", cat: "Motors & Drivers", closet: 5, w: 3, prefix: "A4988" },
  { name: "ULN2003", cat: "Motors & Drivers", closet: 5, w: 4, prefix: "ULN2003" },
  { name: "DC-Motor Driver 43A", cat: "Motors & Drivers", closet: 5, w: 4, prefix: "D43A" },
  { name: "NEMA43-Driver", cat: "Motors & Drivers", closet: 5, w: 1, prefix: "N43D" },
  { name: "Brushless-Motor A2212/10T 2200KV", cat: "Motors & Drivers", closet: 5, w: 2, prefix: "A2212" },
  { name: "ESC 30A", cat: "Motors & Drivers", closet: 5, w: 2, prefix: "ESC30" },
  { name: "DC-Motor Wheel (Blue)", cat: "Motors & Drivers", closet: 5, w: 5, prefix: "WHEEL-B" },
  { name: "DC-Motor Wheel (Yellow)", cat: "Motors & Drivers", closet: 5, w: 8, prefix: "WHEEL-Y" },
  // ===== Power =====
  { name: "LiPo Batteries (3.7V)", cat: "Power", closet: 6, w: 6, prefix: "LIPO" },
  { name: "حاملات بطاريات", cat: "Power", closet: 6, w: 4, prefix: "BHOLD" },
  { name: "TP4056 Micro USB 5V 1A Lithium Battery Charger", cat: "Power", closet: 6, w: 4, prefix: "TP4056" },
  { name: "LiPo Battery-Charger (4.2V/450mA)", cat: "Power", closet: 6, w: 1, prefix: "LIPO-CH" },
  { name: "Voltage Regulator (LM2596)", cat: "Power", closet: 6, w: 6, prefix: "LM2596" },
  { name: "Voltage Regulator (HX-P213)", cat: "Power", closet: 6, w: 3, prefix: "HXP213" },
  { name: "Power Supply (30A)", cat: "Power", closet: 6, w: 1, prefix: "PSU30" },
  { name: "Switch (On/Off)", cat: "Power", closet: 6, w: 2, prefix: "SWITCH" },
  // ===== Mechanical =====
  { name: "دواليب استناد", cat: "Mechanical", closet: 5, w: 10, prefix: "CAST" },
  { name: "Rolman (10mm×26mm)", cat: "Mechanical", closet: 5, w: 6, prefix: "ROL26" },
  { name: "Rolman (5mm×13mm)", cat: "Mechanical", closet: 5, w: 4, prefix: "ROL13" },
  { name: "Rolman (5mm×16mm)", cat: "Mechanical", closet: 5, w: 4, prefix: "ROL16" },
  { name: "Rolman (12mm×32mm)", cat: "Mechanical", closet: 5, w: 2, prefix: "ROL32" },
  { name: "Rolman (15mm×22.5mm)", cat: "Mechanical", closet: 5, w: 3, prefix: "ROL225" },
  { name: "Omni-Wheel", cat: "Mechanical", closet: 5, w: 3, prefix: "OMNI" },
  { name: "منزلقات درج", cat: "Mechanical", closet: 5, w: 4, prefix: "SLIDES" },
  // ===== Camera & Vision =====
  { name: "CANON EOS 750D camera BOX", cat: "Camera & Vision", closet: 8, w: 1, prefix: "CANON-B" },
  { name: "CANON camera lens EF(50mm)", cat: "Camera & Vision", closet: 8, w: 1, prefix: "CANON-50" },
  { name: "CANON camera lens EFS (55-250mm)", cat: "Camera & Vision", closet: 8, w: 1, prefix: "CANON-552" },
  // ===== Displays & IO =====
  { name: "LCD Display (with Touch)", cat: "Displays & IO", closet: 3, w: 1, prefix: "LCD-T" },
  { name: "LCD", cat: "Displays & IO", closet: 3, w: 2, prefix: "LCD" },
  { name: "Push-Button", cat: "Displays & IO", closet: 3, w: 5, prefix: "BTN" },
  { name: "LED-RGB", cat: "Displays & IO", closet: 3, w: 15, prefix: "LED-RGB" },
  { name: "LED-Red", cat: "Displays & IO", closet: 3, w: 10, prefix: "LED-R" },
  { name: "LED-Yellow", cat: "Displays & IO", closet: 3, w: 4, prefix: "LED-Y" },
  { name: "Resistors (1KΩ)", cat: "Displays & IO", closet: 3, w: 20, prefix: "R1K" },
  { name: "Potentiometer", cat: "Displays & IO", closet: 3, w: 1, prefix: "POT" },
  // ===== Cables & Connectors =====
  { name: "Cable Type-B (Arduino-Cable)", cat: "Cables & Connectors", closet: 5, w: 2, prefix: "USB-B" },
  { name: "HDMI - MICRO HDMI", cat: "Cables & Connectors", closet: 5, w: 1, prefix: "HDMI" },
  { name: "SD-Card Micro (64-GB)", cat: "Cables & Connectors", closet: 5, w: 2, prefix: "SDCARD" },
  { name: "Propellers", cat: "Cables & Connectors", closet: 8, w: 2, prefix: "PROP" },
  // ===== Furnishings =====
  { name: "كراسي دوارة", cat: "Furnishings", closet: 6, w: 3, prefix: "CHAIR" },
  { name: "مقص", cat: "Furnishings", closet: 6, w: 2, prefix: "SCISS" },
  { name: "مقصات", cat: "Furnishings", closet: 6, w: 0, b: 1, prefix: "SCISS-B" },
  { name: "بخاخ", cat: "Furnishings", closet: 6, w: 0, b: 3, prefix: "SPRAY" },
  { name: "بكرات طباعة فارغة", cat: "Furnishings", closet: 6, w: 0, b: 30, prefix: "ROLLS" },
  { name: "ترقيمات طاولات", cat: "Furnishings", closet: 6, w: 12, prefix: "TBL-NO" },
  { name: "Projector", cat: "Furnishings", closet: 6, w: 1, prefix: "PROJ" },
  { name: "ASUS Screen 32", cat: "Furnishings", closet: 6, w: 1, prefix: "ASUS32" },
];

// Amount on Project — from the projects sheet
const PROJECTS: { name: string; parts: [string, number][] }[] = [
  {
    name: "Dual Arms",
    parts: [
      ["Rotary-Encoder", 3], ["Power Supply (30A)", 1], ["Arduino Mega 2650", 1],
      ["Servo (MG995)", 2], ["Servo SG90", 1], ["Stepper-Motor (NEMA 23)", 5],
      ["Stepper-Motor (28BYJ-48)", 1], ["Stepper-Motor (NEMA 17)", 2], ["ULN2003", 1],
      ["TB6600", 7], ["Limit-Switch", 3], ["Voltage Regulator (HX-P213)", 1], ["Kinect Camera", 2],
    ],
  },
  {
    name: "Swarm Robots",
    parts: [
      ["دواليب استناد", 4], ["DC-Motor with Encoder (JGA25-370)", 2], ["L298N", 2],
      ["Voltage Regulator (LM2596)", 2], ["DC-Motor Wheel (Blue)", 2], ["Switch (On/Off)", 1],
    ],
  },
  {
    name: "Air Hockey Robot",
    parts: [["Arduino Mega 2650", 1], ["Stepper-Motor (NEMA 23)", 2], ["TB6600", 2]],
  },
  {
    name: "Hecktor Slam Robot",
    parts: [
      ["دواليب استناد", 2], ["Arduino Uno", 1], ["DC-Motor with Encoder (JGA25-370)", 2],
      ["L298N", 1], ["LiPo Batteries (3.7V)", 4], ["Voltage Regulator (LM2596)", 2],
      ["Raspberry Pi (4)", 1], ["DC-Motor Wheel (Blue)", 2], ["RPLIDAR", 1], ["SD-Card Micro (64-GB)", 1],
    ],
  },
  {
    name: "Wall-Climbing Robot",
    parts: [
      ["ESP32", 1], ["Servo (MG995)", 2], ["Brushless-Motor A2212/10T 2200KV", 2],
      ["ESC 30A", 2], ["Voltage Regulator (LM2596)", 2],
    ],
  },
  {
    name: "5-Bar Robot",
    parts: [
      ["Arduino Uno", 1], ["Mini Bread-Board", 1], ["Stepper-Motor (28BYJ-48)", 2], ["ULN2003", 2],
    ],
  },
  {
    name: "Tracked Robot",
    parts: [
      ["Rolman (10mm×26mm)", 4], ["Rolman (5mm×13mm)", 2], ["Rolman (5mm×16mm)", 2],
      ["دواليب استناد", 8], ["Arduino Mega 2650", 1], ["ESP32", 1], ["Servo (MG995)", 2],
      ["DC-Motor with Encoder (JGA25-370)", 4], ["Stepper-Motor (NEMA 17)", 3], ["TB6600", 3],
      ["DC-Motor Driver 43A", 4], ["Voltage Regulator (HX-P213)", 1],
    ],
  },
  {
    name: "Self-Balancing Table",
    parts: [["Arduino Mega 2650", 1], ["Servo (MG995)", 2], ["MPU-6050", 1]],
  },
  {
    name: "Self-Parking Robot",
    parts: [
      ["Ultra-Sonic", 3], ["حاملات بطاريات", 2], ["دواليب استناد", 1],
      ["DC-Motor with Encoder (JGA25-370)", 2], ["L298N", 1], ["DC-Motor Wheel (Blue)", 2],
      ["Switch (On/Off)", 1], ["TP4056 Micro USB 5V 1A Lithium Battery Charger", 4],
    ],
  },
  {
    name: "Gear-Box Nema(17)",
    parts: [["Rolman (12mm×32mm)", 1], ["Stepper-Motor (NEMA 17)", 1], ["Rolman (15mm×22.5mm)", 2]],
  },
  { name: "Robot Arm 6DOF (Plixey)", parts: [] },
  { name: "CNC for Milling", parts: [] },
  { name: "QuadCopter", parts: [] },
  { name: "AUV", parts: [] },
];

// Members — [name, email, positions, state, job, year, uniId, personalId, phone, role]
const MEMBERS: [string, string, string, string, string, string, string, string, string, string][] = [
  ["د. عيسى الغنّام", "essaalghnnam@gmail.com", "رئيس نادي الروبوت", "دكتوراه", "ميكاترونيكس", "", "", "", "+963996063235", "admin"],
  ["أمين فايز حيدر", "amin20haydar@gmail.com", "منسق النادي, عضو علمي, عضو إداري, مدرّب, عضو إعلامي", "جامعي", "ميكاترونيكس", "4", "2872", "06170038280", "+963930756990", "admin"],
  ["نور فوّاز مسيلماني", "nour2001mselmani@gmail.com", "عضو علمي, عضو إداري, مدرّب, عضو إعلامي", "جامعي", "ميكاترونيكس", "5", "2880", "06090082332", "+963954231908", "member"],
  ["جعفر علي رقماني", "tesla1infernal2@gmail.com", "عضو علمي, عضو إداري, مدرّب", "جامعي", "ميكاترونيكس", "4", "2987", "10180003423", "+963937952557", "member"],
  ["حيدرة علي محرز", "haide2001rmhrez@gmail.com", "عضو علمي, مدرّب", "جامعي", "ميكاترونيكس", "5", "2886", "06110002825", "+963937715044", "member"],
  ["علي فيصل يوسف", "ss@gmail.com", "عضو علمي, مدرّب", "جامعي", "ميكاترونيكس", "4", "2916", "", "+963932722234", "member"],
  ["خضر عماد عيسى", "khderissa002@gmail.com", "عضو علمي, مدرّب", "جامعي", "ميكاترونيكس", "4", "2986", "", "+963991855598", "member"],
  ["تسنيم لؤي كنيفاتي", "ss@gmail.com", "عضو علمي, مدرّب, عضو إعلامي", "جامعي", "ميكاترونيكس", "4", "3032", "", "+963947758481", "member"],
  ["حسن عماد الورعة", "hasanalwaraa86@gmail.com", "عضو علمي, عضو إداري, مدرّب", "جامعي", "ميكاترونيكس", "4", "3030", "06230014722", "+963995425327", "member"],
  ["عبدالرحمن عبدالسلام بلاش", "abodebalash@gmail.com", "عضو علمي", "جامعي", "ميكاترونيكس", "2", "3381", "06010379855", "+963998785855", "member"],
  ["فجر أبو الخير", "faajeer2003@gmail.com", "عضو علمي", "جامعي", "ميكاترونيكس", "3", "3198", "", "+963937557482", "member"],
  ["عبدالله ميشيل اسكيف", "abdullah.m.eskef@gmail.com", "عضو علمي", "جامعي", "قوى ميكانيكية", "5", "2274", "", "+963937001322", "member"],
  // loan/reference people (no auth accounts yet)
  ["د. باسل قدّار", "", "", "دكتوراه", "تصميم وإنتاج", "", "", "", "+963992189903", "member"],
  ["سليمان خليل عيسى", "", "", "جامعي", "ميكاترونيكس", "4", "2760", "06110033392", "+963994850018", "member"],
  ["باهر خيربك", "", "", "جامعي", "ميكاترونيكس", "4", "2743", "06200043182", "+963941300474", "member"],
  ["م. حسام حسن حسن", "", "", "مُتخرج", "ميكاترونيكس", "", "", "0601014300", "+963966748400", "member"],
  ["مجد سُميّ زهرة", "", "", "جامعي", "ميكاترونيكس", "5", "2263", "06020000567", "+963936393007", "member"],
  ["مجد خضر علي", "", "", "جامعي", "ميكاترونيكس", "4", "", "", "+963998887155", "member"],
  ["أحمد جمعة", "", "", "مُتخرج", "ميكاترونيكس", "", "", "12110060109", "+963938009485", "member"],
  ["أحمد أسعد أحمد", "", "", "ماجستير", "ميكاترونيكس", "", "", "", "+963982362406", "member"],
  ["علي مرتكوش", "", "", "جامعي", "ميكاترونيكس", "4", "2773", "06020073826", "+963985683281", "member"],
  ["محمد حسن ابراهيم", "", "", "ماجستير", "ميكاترونيكس", "", "", "", "+963930320197", "member"],
  ["جعفر علي حايك", "jafarhayek@gmail.com", "", "جامعي", "تصميم وإنتاج", "4", "3108", "6020036305", "+963994561580", "member"],
  ["الرضا منذر محمد", "rida.mmhd@gmail.com", "", "جامعي", "ميكاترونيكس", "4", "3100", "6010029913", "+963996427454", "member"],
];

// Loans — [name, phone, state, job, part, amount, lentDate, returned, returnDate, notes]
const LOANS: [string, string, string, string, string, number, string, boolean, string, string][] = [
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "DC-Motor with Encoder (CHR-MG25-370)", 1, "11/30/2021", false, "", ""],
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "L298N", 1, "11/30/2021", false, "", ""],
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "ESP8266", 1, "11/30/2021", false, "", ""],
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "LiPo Batteries (3.7V)", 4, "5/8/2022", false, "", ""],
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "Pic-Programming Adapter", 1, "5/8/2022", false, "", ""],
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "MPU-9250", 1, "5/8/2022", false, "", ""],
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "Jetson Nano", 1, "3/28/2022", true, "4/22/2024", ""],
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "LCD Display (with Touch)", 1, "5/16/2022", false, "", ""],
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "HDMI - MICRO HDMI", 1, "5/16/2022", false, "", ""],
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "Stepper-Motor (NEMA 43)", 1, "7/29/2022", true, "", "على مشروع الفارزة"],
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "NEMA43-Driver", 1, "7/29/2022", true, "", "على مشروع الفارزة"],
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "Raspberry Pi Camera", 1, "10/12/2022", false, "", ""],
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "RPLIDAR", 1, "10/12/2022", false, "", ""],
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "SD-Card Micro (64-GB)", 1, "11/24/2022", false, "", ""],
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "ESP32", 1, "11/24/2022", false, "", ""],
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "A4988", 1, "3/20/2023", false, "", ""],
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "SD-Card Micro (64-GB)", 1, "5/21/2023", false, "", ""],
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "Stepper-Motor (NEMA 23)", 1, "5/21/2023", false, "", ""],
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "Omni-Wheel", 3, "10/10/2023", false, "", "مشروع ظلال"],
  ["د. عيسى الغنّام", "+963996063235", "دكتوراه", "ميكاترونيكس", "منزلقات درج", 4, "2/6/2024", false, "", ""],
  ["نور فوّاز مسيلماني", "+963954231908", "جامعي", "ميكاترونيكس", "منزلقات درج", 2, "1/18/2024", false, "", "صارو مع الدكتور عيسى"],
  ["د. باسل قدّار", "+963992189903", "دكتوراه", "تصميم وإنتاج", "PIR", 1, "11/30/2021", false, "", ""],
  ["سليمان خليل عيسى", "+963994850018", "جامعي", "ميكاترونيكس", "Arduino Uno", 3, "2/9/2022", true, "11/11/2022", ""],
  ["سليمان خليل عيسى", "+963994850018", "جامعي", "ميكاترونيكس", "Ultra-Sonic", 3, "2/9/2022", true, "11/11/2022", ""],
  ["سليمان خليل عيسى", "+963994850018", "جامعي", "ميكاترونيكس", "PIR", 5, "2/9/2022", true, "11/11/2022", ""],
  ["سليمان خليل عيسى", "+963994850018", "جامعي", "ميكاترونيكس", "Brushless-Motor A2212/10T 2200KV", 1, "2/9/2022", true, "11/11/2022", ""],
  ["سليمان خليل عيسى", "+963994850018", "جامعي", "ميكاترونيكس", "ESC 30A", 1, "2/9/2022", true, "11/11/2022", ""],
  ["سليمان خليل عيسى", "+963994850018", "جامعي", "ميكاترونيكس", "LiPo Batteries (3.7V)", 3, "2/9/2022", true, "11/11/2022", ""],
  ["سليمان خليل عيسى", "+963994850018", "جامعي", "ميكاترونيكس", "حاملات بطاريات", 3, "2/9/2022", true, "11/11/2022", ""],
  ["سليمان خليل عيسى", "+963994850018", "جامعي", "ميكاترونيكس", "LiPo Battery-Charger (4.2V/450mA)", 1, "2/9/2022", true, "11/11/2022", ""],
  ["سليمان خليل عيسى", "+963994850018", "جامعي", "ميكاترونيكس", "Resistors (1KΩ)", 20, "2/9/2022", true, "11/11/2022", ""],
  ["سليمان خليل عيسى", "+963994850018", "جامعي", "ميكاترونيكس", "LED-RGB", 15, "2/9/2022", true, "11/11/2022", ""],
  ["سليمان خليل عيسى", "+963994850018", "جامعي", "ميكاترونيكس", "Push-Button", 5, "2/9/2022", true, "11/11/2022", ""],
  ["سليمان خليل عيسى", "+963994850018", "جامعي", "ميكاترونيكس", "LED-Red", 10, "2/9/2022", true, "11/11/2022", ""],
  ["سليمان خليل عيسى", "+963994850018", "جامعي", "ميكاترونيكس", "LED-Yellow", 4, "2/9/2022", true, "11/11/2022", ""],
  ["سليمان خليل عيسى", "+963994850018", "جامعي", "ميكاترونيكس", "Potentiometer", 1, "2/9/2022", true, "11/11/2022", ""],
  ["سليمان خليل عيسى", "+963994850018", "جامعي", "ميكاترونيكس", "LM35", 1, "2/9/2022", true, "11/11/2022", ""],
  ["سليمان خليل عيسى", "+963994850018", "جامعي", "ميكاترونيكس", "LDR", 3, "2/9/2022", true, "11/11/2022", ""],
  ["سليمان خليل عيسى", "+963994850018", "جامعي", "ميكاترونيكس", "LCD", 2, "4/25/2023", false, "", ""],
  ["باهر خيربك", "+963941300474", "جامعي", "ميكاترونيكس", "Brushless-Motor A2212/10T 2200KV", 2, "2/5/2022", true, "8/21/2022", ""],
  ["باهر خيربك", "+963941300474", "جامعي", "ميكاترونيكس", "ESC 30A", 2, "2/5/2022", true, "8/21/2022", ""],
  ["باهر خيربك", "+963941300474", "جامعي", "ميكاترونيكس", "Propellers", 2, "2/5/2022", true, "8/21/2022", ""],
  ["باهر خيربك", "+963941300474", "جامعي", "ميكاترونيكس", "MPU-6050", 2, "2/5/2022", true, "8/21/2022", ""],
  ["باهر خيربك", "+963941300474", "جامعي", "ميكاترونيكس", "بكرة قصدير", 1, "2/5/2022", true, "8/21/2022", ""],
  ["باهر خيربك", "+963941300474", "جامعي", "ميكاترونيكس", "كاوي قصدير", 1, "2/5/2022", true, "8/21/2022", ""],
  ["باهر خيربك", "+963941300474", "جامعي", "ميكاترونيكس", "قاعدة كاوي قصدير", 1, "2/5/2022", true, "8/21/2022", ""],
  ["باهر خيربك", "+963941300474", "جامعي", "ميكاترونيكس", "Avometer", 1, "2/5/2022", true, "8/21/2022", ""],
  ["باهر خيربك", "+963941300474", "جامعي", "ميكاترونيكس", "Raspberry Pi (4)", 1, "2/7/2022", true, "8/21/2022", ""],
  ["باهر خيربك", "+963941300474", "جامعي", "ميكاترونيكس", "Arduino Uno", 1, "2/7/2022", true, "8/21/2022", ""],
  ["باهر خيربك", "+963941300474", "جامعي", "ميكاترونيكس", "Cable Type-B (Arduino-Cable)", 1, "2/7/2022", true, "8/21/2022", ""],
  ["باهر خيربك", "+963941300474", "جامعي", "ميكاترونيكس", "قاعدة كاوي قصدير", 1, "3/27/2022", true, "8/21/2022", ""],
  ["م. حسام حسن حسن", "+963966748400", "مُتخرج", "ميكاترونيكس", "Stepper-Motor (NEMA 17)", 2, "2/5/2022", true, "6/1/2022", "من جامعة دمشق"],
  ["م. حسام حسن حسن", "+963966748400", "مُتخرج", "ميكاترونيكس", "DC-Motor Wheel (Yellow)", 8, "2/5/2022", true, "6/1/2022", "من جامعة دمشق"],
  ["م. حسام حسن حسن", "+963966748400", "مُتخرج", "ميكاترونيكس", "TB6600", 2, "2/5/2022", true, "6/1/2022", "من جامعة دمشق"],
  ["م. حسام حسن حسن", "+963966748400", "مُتخرج", "ميكاترونيكس", "Rolman (10mm×26mm)", 4, "2/5/2022", true, "6/1/2022", "من جامعة دمشق"],
  ["م. حسام حسن حسن", "+963966748400", "مُتخرج", "ميكاترونيكس", "MPU-6050", 2, "2/5/2022", false, "", "من جامعة دمشق"],
  ["م. حسام حسن حسن", "+963966748400", "مُتخرج", "ميكاترونيكس", "Arduino Mega 2650", 1, "3/22/2022", false, "", "من جامعة دمشق"],
  ["م. حسام حسن حسن", "+963966748400", "مُتخرج", "ميكاترونيكس", "Cable Type-B (Arduino-Cable)", 1, "3/22/2022", false, "", "من جامعة دمشق"],
  ["م. حسام حسن حسن", "+963966748400", "مُتخرج", "ميكاترونيكس", "Optical-Encoder", 2, "3/22/2022", false, "", "مع طاولة المشروع"],
  ["مجد سُميّ زهرة", "+963936393007", "جامعي", "ميكاترونيكس", "Power Supply (30A)", 1, "2/24/2022", true, "", "Quadcopter — الآن في ذمّة أمين حيدر"],
  ["مجد سُميّ زهرة", "+963936393007", "جامعي", "ميكاترونيكس", "Avometer", 1, "2/24/2022", true, "", "Quadcopter — الآن في ذمّة أمين حيدر"],
  ["مجد سُميّ زهرة", "+963936393007", "جامعي", "ميكاترونيكس", "BeagleBone-Blue", 1, "2/24/2022", true, "", ""],
  ["مجد سُميّ زهرة", "+963936393007", "جامعي", "ميكاترونيكس", "MPU-6050", 1, "2/24/2022", true, "", "Quadcopter — الآن في ذمّة أمين حيدر"],
  ["مجد سُميّ زهرة", "+963936393007", "جامعي", "ميكاترونيكس", "WiFi Module", 1, "2/27/2022", true, "", "Quadcopter — الآن في ذمّة أمين حيدر"],
  ["مجد سُميّ زهرة", "+963936393007", "جامعي", "ميكاترونيكس", "Optical-Encoder", 1, "7/29/2022", true, "", ""],
  ["مجد سُميّ زهرة", "+963936393007", "جامعي", "ميكاترونيكس", "Voltage Regulator (LM2596)", 1, "7/29/2022", true, "", ""],
  ["مجد سُميّ زهرة", "+963936393007", "جامعي", "ميكاترونيكس", "Raspberry Pi (4)", 1, "2/27/2022", true, "3/14/2022", ""],
  ["مجد سُميّ زهرة", "+963936393007", "جامعي", "ميكاترونيكس", "Brushless-Motor A2212/10T 2200KV", 2, "2/27/2022", true, "3/14/2022", ""],
  ["مجد سُميّ زهرة", "+963936393007", "جامعي", "ميكاترونيكس", "Laser-Sensors (VL53LXX-V2)", 1, "5/15/2023", true, "4/30/2024", "تم تسليمه لحسن — جرد على الخزانة 5"],
  ["مجد خضر علي", "+963998887155", "جامعي", "ميكاترونيكس", "L298N", 1, "2/27/2022", true, "4/1/2022", "أعيد عند استلام أمين حيدر رتبة منسّق النادي"],
  ["مجد خضر علي", "+963998887155", "جامعي", "ميكاترونيكس", "CANON EOS 750D camera BOX", 1, "2/27/2022", true, "4/1/2022", ""],
  ["مجد خضر علي", "+963998887155", "جامعي", "ميكاترونيكس", "CANON camera lens EF(50mm)", 1, "2/27/2022", true, "4/1/2022", ""],
  ["مجد خضر علي", "+963998887155", "جامعي", "ميكاترونيكس", "CANON camera lens EFS (55-250mm)", 1, "2/27/2022", true, "4/1/2022", ""],
  ["مجد خضر علي", "+963998887155", "جامعي", "ميكاترونيكس", "Stepper-Motor (NEMA 43)", 2, "4/13/2022", true, "11/13/2022", "على مشروع الفارزة"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "DC-Motor with Encoder (JGA25-370)", 4, "3/10/2022", true, "4/30/2024", "2 على Hecktor و 2 على Swarm"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "Raspberry Pi (4)", 1, "3/10/2022", true, "4/30/2024", "بالخزانة 5"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "DC-Motor (JGA25-370)", 4, "4/4/2022", true, "4/30/2024", "بالخزانة 6"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "DC-Motor with Encoder (CHR-MG25-370)", 1, "5/8/2022", true, "5/8/2022", ""],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "ESP32", 1, "5/8/2022", true, "5/8/2022", ""],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "Voltage Regulator (LM2596)", 1, "5/8/2022", true, "4/30/2024", "بالخزانة 6 (تالف)"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "WiFi Module", 1, "5/10/2022", true, "4/30/2024", "بالخزانة 6 (تالف)"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "Optical Encoder (MH-Sensor-Series)", 1, "5/12/2022", true, "4/30/2024", "بالخزانة 5"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "HDMI - MICRO HDMI", 1, "5/16/2022", true, "4/30/2024", ""],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "LCD Display (with Touch)", 1, "5/16/2022", true, "4/30/2024", "بالخزانة 6"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "DC-Motor with Encoder (JGA25-370)", 2, "5/16/2022", true, "4/30/2024", "بالخزانة 6"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "دواليب استناد", 2, "5/16/2022", true, "4/30/2024", "Swarm Robot"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "TB6600", 1, "5/16/2022", true, "4/30/2024", "بالخزانة 6 (تالف)"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "منشار خشب كهربائي", 1, "7/29/2022", true, "4/30/2024", "بالخزانة 5"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "CANON camera lens EF(50mm)", 1, "7/25/2022", false, "", "بالخزانة 8"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "CANON camera lens EFS (55-250mm)", 1, "7/25/2022", false, "", "بالخزانة 8"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "CANON EOS 750D camera BOX", 1, "7/25/2022", false, "", "بالخزانة 8"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "Arduino Mega 2650", 4, "9/6/2022", true, "4/30/2024", "3 تالفة بالخزانة 6، واحد على Dual Arms"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "Arduino Uno", 5, "9/6/2022", true, "4/30/2024", "4 تالفة بالخزانة 6، واحد بالخزانة 5"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "PIR", 5, "9/6/2022", true, "4/30/2024", "الخزانة 5"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "L298N", 7, "9/6/2022", true, "4/30/2024", "4 تالفة بالخزانة 6، 3 بالخزانة 6"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "DC-Motor (TTL)", 11, "9/6/2022", true, "4/30/2024", "3 تالفة بالخزانة 6، الباقي بالخزانة 5"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "DC-Motor (JGA25-370)", 4, "9/6/2022", true, "4/30/2024", "بالخزانة 6"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "Ultra-Sonic", 6, "9/6/2022", true, "4/30/2024", "3 تالفة بالخزانة 6، 3 بالخزانة 6"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "Servo (MG995)", 5, "9/6/2022", true, "4/30/2024", "الخزانة 6 (تالف)"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "Servo-Horn (MG995)", 5, "9/6/2022", true, "4/30/2024", "مجرود على اسم الخزانة 5"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "TB6600", 2, "10/25/2022", true, "4/30/2024", "Dual Arms"],
  ["أمين فايز حيدر", "+963930756990", "جامعي", "ميكاترونيكس", "A4988", 2, "3/30/2023", true, "4/30/2024", "بالخزانة 6 (تالف)"],
];

// ----- helpers -----

function norm(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
function fuzzy(s: string) {
  return norm(s).replace(/[^a-z0-9\u0600-\u06FF]+/g, "");
}
function parseDate(d: string) {
  if (!d) return undefined;
  const [m, day, y] = d.split("/").map((x) => parseInt(x, 10));
  if (!m || !day || !y) return undefined;
  return new Date(y, m - 1, day).getTime();
}

export const seedClubData = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const started = Date.now();

    // wipe inventory tables so re-imports are clean (users/auth are kept)
    for (const table of ["parts", "rentals", "groups", "projects", "closets", "categories"] as const) {
      const rows = await ctx.db.query(table).collect();
      for (const r of rows) await ctx.db.delete(r._id);
    }

    // closets 1..8
    const closetIds: Record<number, string> = {};
    for (const c of CLOSETS) {
      closetIds[CLOSETS.indexOf(c) + 1] = await ctx.db.insert("closets", c);
    }

    // categories
    const catIds: Record<string, string> = {};
    for (const c of CATEGORIES) {
      catIds[c] = await ctx.db.insert("categories", { name: c });
    }
    const miscCat = catIds["Kits"];

    // users — upsert by email so auth accounts merge cleanly
    const userByEmail = new Map<string, string>();
    const ensureUser = async (name: string, email: string, role: "admin" | "member", phone: string, state: string, job: string, year: string, uniId: string, personalId: string) => {
      const key = (email || name).trim().toLowerCase();
      if (userByEmail.has(key)) return userByEmail.get(key)!;
      let id: string | null = null;
      if (email) {
        const existing = await ctx.db
          .query("users")
          .withIndex("email", (q) => q.eq("email", email.trim()))
          .first();
        if (existing) {
          const patch: Record<string, unknown> = {};
          if (!existing.name && name) patch.name = name;
          if (role === "admin") patch.role = "admin";
          if (year && !existing.studentId) patch.studentId = year;
          if (phone && !existing.phone) patch.phone = phone;
          if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
          id = existing._id;
        }
      }
      if (!id) {
        id = await ctx.db.insert("users", {
          name,
          email: email || undefined,
          role,
          phone: phone || undefined,
          studentId: uniId || year || undefined,
        });
      }
      userByEmail.set(key, id);
      return id;
    };

    const memberIds: Record<string, string> = {};
    for (const [name, email, positions, state, job, year, uniId, personalId, phone, role] of MEMBERS) {
      const id = await ensureUser(
        name,
        email,
        role === "admin" ? "admin" : "member",
        phone,
        state,
        job,
        year,
        uniId,
        personalId,
      );
      memberIds[name] = id;
    }

    // projects
    const projectIds: Record<string, string> = {};
    for (const p of PROJECTS) {
      projectIds[p.name] = await ctx.db.insert("projects", {
        name: p.name,
        description: `Club build — ${p.parts.length} part types assigned`,
        status: "active",
        ownerId: memberIds[p.name] as any ?? undefined,
      });
    }

    // groups + parts
    const groupIds = new Map<string, string>();
    const groupParts = new Map<string, Id<"parts">[]>();
    const prefixOf = (name: string) =>
      name
        .replace(/[^A-Za-z0-9 ]/g, "")
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 3)
        .padEnd(3, "X");

    for (const g of GROUPS) {
      const catId = catIds[g.cat] ?? miscCat;
      const closetId = closetIds[g.closet];
      const total = g.w + (g.b ?? 0);
      const groupId = await ctx.db.insert("groups", {
        name: g.name,
        categoryId: catId as any,
        closetId: closetId as any,
        quantityTotal: total,
        description: g.note,
      });
      groupIds.set(fuzzy(g.name), groupId);
      groupIds.set(norm(g.name), groupId);
      for (const a of g.aliases ?? []) {
        groupIds.set(fuzzy(a), groupId);
        groupIds.set(norm(a), groupId);
      }
      const parts: Id<"parts">[] = [];
      const prefix = g.prefix ?? prefixOf(g.name);
      const make = async (n: number, status: "available" | "broken") => {
        for (let i = 1; i <= n; i++) {
          const tag = `${prefix}-${String(parts.length + 1).padStart(3, "0")}`;
          const id = await ctx.db.insert("parts", { groupId, tag, status });
          parts.push(id);
        }
      };
      await make(g.w, "available");
      await make(g.b ?? 0, "broken");
      await ctx.db.patch(groupId, { quantityTotal: parts.length });
      groupParts.set(groupId, parts);
    }

    const findGroup = (raw: string): string | null => {
      const f = fuzzy(raw);
      return groupIds.get(f) ?? groupIds.get(norm(raw)) ?? null;
    };
    const takeAvailable = async (groupId: string, n: number): Promise<Id<"parts">[]> => {
      const parts = groupParts.get(groupId) ?? [];
      const out: Id<"parts">[] = [];
      for (const p of parts) {
        if (out.length >= n) break;
        const doc = await ctx.db.get(p);
        if (doc && doc.status === "available") {
          out.push(p);
        }
      }
      return out;
    };

    // assign parts to projects
    for (const proj of PROJECTS) {
      const pid = projectIds[proj.name];
      if (!pid) continue;
      for (const [partName, amount] of proj.parts) {
        const gid = findGroup(partName);
        if (!gid) continue;
        const chosen = await takeAvailable(gid, amount);
        for (const p of chosen) {
          await ctx.db.patch(p, { status: "on_project", currentProjectId: pid as any });
        }
      }
    }

    // loans → rentals
    let activeLoans = 0;
    let historyLoans = 0;
    let skipped = 0;
    for (const [name, phone, state, job, partName, amount, lentDate, returned, returnDate, notes] of LOANS) {
      const userId = memberIds[name] ?? (await ensureUser(name, "", "member", phone, state, job, "", "", ""));
      const gid = findGroup(partName);
      if (!gid) {
        skipped += 1;
        continue;
      }
      const lent = parseDate(lentDate);
      const returnedAt = parseDate(returnDate);
      const chosen = await takeAvailable(gid, amount);
      for (const p of chosen) {
        if (returned) {
          await ctx.db.insert("rentals", {
            partId: p as any,
            userId: userId as any,
            status: "returned",
            requestedAt: lent ?? started,
            returnedAt: returnedAt ?? lent ?? started,
            conditionReport: notes || undefined,
          });
          historyLoans += 1;
        } else {
          await ctx.db.patch(p as any, { status: "rented", currentHolderId: userId as any });
          await ctx.db.insert("rentals", {
            partId: p as any,
            userId: userId as any,
            status: "active",
            requestedAt: lent ?? started,
            pickedUpAt: lent ?? started,
            conditionReport: notes || undefined,
          });
          activeLoans += 1;
        }
      }
    }

    await ctx.db.insert("seedState", { key: "club" });

    const groupsCount = GROUPS.length;
    const partsCount = groupParts.size
      ? (await ctx.db.query("parts").collect()).length
      : 0;
    return {
      seeded: true,
      groups: groupsCount,
      parts: partsCount,
      projects: PROJECTS.length,
      members: MEMBERS.length,
      activeLoans,
      historyLoans,
      skipped,
    };
  },
});

export const isClubSeeded = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("seedState")
      .withIndex("by_key", (q) => q.eq("key", "club"))
      .first();
    return Boolean(row);
  },
});