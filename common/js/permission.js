/**
 * 本模块封装了Android、iOS的应用权限判断、打开应用权限设置界面、以及位置系统服务是否开启
 */

var isIos
// #ifdef APP-PLUS
isIos = (plus.os.name == "iOS")
// #endif

// 判断推送权限是否开启
function judgeIosPermissionPush() {
	var result = false;
	var UIApplication = plus.ios.import("UIApplication");
	var app = UIApplication.sharedApplication();
	var enabledTypes = 0;
	if (app.currentUserNotificationSettings) {
		var settings = app.currentUserNotificationSettings();
		enabledTypes = settings.plusGetAttribute("types");
		console.log("enabledTypes1:" + enabledTypes);
		if (enabledTypes == 0) {
			console.log("推送权限没有开启");
		} else {
			result = true;
			console.log("已经开启推送功能!")
		}
		plus.ios.deleteObject(settings);
	} else {
		enabledTypes = app.enabledRemoteNotificationTypes();
		if (enabledTypes == 0) {
			console.log("推送权限没有开启!");
		} else {
			result = true;
			console.log("已经开启推送功能!")
		}
		console.log("enabledTypes2:" + enabledTypes);
	}
	plus.ios.deleteObject(app);
	plus.ios.deleteObject(UIApplication);
	return result;
}

// 判断ios定位权限是否开启
function judgeIosPermissionLocation() {
	var result = false;
	var cllocationManger = plus.ios.import("CLLocationManager");
	var status = cllocationManger.authorizationStatus();
	result = (status != 2)
	// console.log("定位权限开启：" + result);
	// 以下代码判断了手机设备的定位是否关闭，推荐另行使用方法 checkSystemEnableLocation
	/* var enable = cllocationManger.locationServicesEnabled();
	var status = cllocationManger.authorizationStatus();
	console.log("enable:" + enable);
	console.log("status:" + status);
	if (enable && status != 2) {
		result = true;
		console.log("手机定位服务已开启且已授予定位权限");
	} else {
		console.log("手机系统的定位没有打开或未给予定位权限");
	} */
	plus.ios.deleteObject(cllocationManger);
	return result;
}

// 判断麦克风权限是否开启
function judgeIosPermissionRecord() {
	var result = false;
	var avaudiosession = plus.ios.import("AVAudioSession");
	var avaudio = avaudiosession.sharedInstance();
	var permissionStatus = avaudio.recordPermission();
	// console.log("permissionStatus:" + permissionStatus);
	if (permissionStatus == 1684369017 || permissionStatus == 1970168948) {
		console.log("麦克风权限没有开启");
	} else {
		result = true;
		console.log("麦克风权限已经开启");
	}
	plus.ios.deleteObject(avaudiosession);
	return result;
}

// 判断相机权限是否开启
function judgeIosPermissionCamera() {
	var result = false;
	var AVCaptureDevice = plus.ios.import("AVCaptureDevice");
	var authStatus = AVCaptureDevice.authorizationStatusForMediaType('vide');
	console.log("authStatus:" + authStatus);
	if (authStatus == 3) {
		result = true;
		// console.log("相机权限已经开启");
	} else {
		// console.log("相机权限没有开启");
	}
	plus.ios.deleteObject(AVCaptureDevice);
	return result;
}

// 判断相册权限是否开启
function judgeIosPermissionPhotoLibrary() {
	var result = false;
	var PHPhotoLibrary = plus.ios.import("PHPhotoLibrary");
	var authStatus = PHPhotoLibrary.authorizationStatus();
	console.log("authStatus:" + authStatus);
	if (authStatus == 3) {
		result = true;
		// console.log("相册权限已经开启");
	} else {
		// console.log("相册权限没有开启");
	}
	plus.ios.deleteObject(PHPhotoLibrary);
	return result;
}

// 判断通讯录权限是否开启
function judgeIosPermissionContact() {
	var result = false;
	var CNContactStore = plus.ios.import("CNContactStore");
	var cnAuthStatus = CNContactStore.authorizationStatusForEntityType(0);
	if (cnAuthStatus == 3) {
		result = true;
		// console.log("通讯录权限已经开启");
	} else {
		// console.log("通讯录权限没有开启");
	}
	plus.ios.deleteObject(CNContactStore);
	return result;
}

// 判断日历权限是否开启
function judgeIosPermissionCalendar() {
	var result = false;
	var EKEventStore = plus.ios.import("EKEventStore");
	var ekAuthStatus = EKEventStore.authorizationStatusForEntityType(0);
	if (ekAuthStatus == 3) {
		result = true;
		console.log("日历权限已经开启");
	} else {
		console.log("日历权限没有开启");
	}
	plus.ios.deleteObject(EKEventStore);
	return result;
}

// 判断备忘录权限是否开启
function judgeIosPermissionMemo() {
	var result = false;
	var EKEventStore = plus.ios.import("EKEventStore");
	var ekAuthStatus = EKEventStore.authorizationStatusForEntityType(1);
	if (ekAuthStatus == 3) {
		result = true;
		console.log("备忘录权限已经开启");
	} else {
		console.log("备忘录权限没有开启");
	}
	plus.ios.deleteObject(EKEventStore);
	return result;
}

// Android权限查询
function requestAndroidPermission(permissionID) {
	return new Promise((resolve, reject) => {
		plus.android.requestPermissions(
			[permissionID], // 理论上支持多个权限同时查询，但实际上本函数封装只处理了一个权限的情况。有需要的可自行扩展封装
			function(resultObj) {
				var result = 0;
				for (var i = 0; i < resultObj.granted.length; i++) {
					var grantedPermission = resultObj.granted[i];
					// console.log('已获取的权限：' + grantedPermission);
					result = 1
				}
				for (var i = 0; i < resultObj.deniedPresent.length; i++) {
					var deniedPresentPermission = resultObj.deniedPresent[i];
					// console.log('拒绝本次申请的权限：' + deniedPresentPermission);
					result = 0
				}
				for (var i = 0; i < resultObj.deniedAlways.length; i++) {
					var deniedAlwaysPermission = resultObj.deniedAlways[i];
					// console.log('永久拒绝申请的权限：' + deniedAlwaysPermission);
					result = -1
				}
				resolve(result);
				// 若所需权限被拒绝,则打开APP设置界面,可以在APP设置界面打开相应权限
				// if (result != 1) {
				// gotoAppPermissionSetting()
				// }
			},
			function(error) {
				// console.log('申请权限错误：' + error.code + " = " + error.message);
				resolve({
					code: error.code,
					message: error.message
				});
			}
		);
	});
}

// 使用一个方法，根据参数判断权限
function judgeIosPermission(permissionID) {
	if (permissionID == "location") {
		return judgeIosPermissionLocation()
	} else if (permissionID == "camera") {
		return judgeIosPermissionCamera()
	} else if (permissionID == "photoLibrary") {
		return judgeIosPermissionPhotoLibrary()
	} else if (permissionID == "record") {
		return judgeIosPermissionRecord()
	} else if (permissionID == "push") {
		return judgeIosPermissionPush()
	} else if (permissionID == "contact") {
		return judgeIosPermissionContact()
	} else if (permissionID == "calendar") {
		return judgeIosPermissionCalendar()
	} else if (permissionID == "memo") {
		return judgeIosPermissionMemo()
	}
	return false;
}

// 跳转到**应用**的权限页面
function gotoAppPermissionSetting() {
	// console.log(isIos, '123==');
	if (isIos) {
		plus.runtime.openURL('app-settings://')

		// var UIApplication = plus.ios.import("UIApplication");
		// var application2 = UIApplication.sharedApplication();
		// var NSURL2 = plus.ios.import("NSURL");
		// // var setting2 = NSURL2.URLWithString("prefs:root=LOCATION_SERVICES");
		// var setting2 = NSURL2.URLWithString("app-settings:");
		// application2.openURL(setting2);

		// plus.ios.deleteObject(setting2);
		// plus.ios.deleteObject(NSURL2);
		// plus.ios.deleteObject(application2);
	} else {
		// console.log(plus.device.vendor);
		var Intent = plus.android.importClass("android.content.Intent");
		var Settings = plus.android.importClass("android.provider.Settings");
		var Uri = plus.android.importClass("android.net.Uri");
		var mainActivity = plus.android.runtimeMainActivity();
		var intent = new Intent();
		intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
		var uri = Uri.fromParts("package", mainActivity.getPackageName(), null);
		intent.setData(uri);
		mainActivity.startActivity(intent);
	}
}

// 检查系统的定位服务是否开启
function checkSystemEnableLocation() {
	if (isIos) {
		var result = false;
		var cllocationManger = plus.ios.import("CLLocationManager");
		var result = cllocationManger.locationServicesEnabled();
		// console.log("系统定位开启:" + result);
		plus.ios.deleteObject(cllocationManger);
		return result;
	} else {
		var context = plus.android.importClass("android.content.Context");
		var locationManager = plus.android.importClass("android.location.LocationManager");
		var main = plus.android.runtimeMainActivity();
		var mainSvr = main.getSystemService(context.LOCATION_SERVICE);
		var result = mainSvr.isProviderEnabled(locationManager.GPS_PROVIDER);
		// console.log("系统定位开启:" + result);
		return result
	}
}

//判断定位权限，返回true或者false
async function locationJur() {
	if (isIos) {
		//如果是苹果
		let iosRes = judgeIosPermission('location')
		return iosRes //真代表以获取授权
	} else {
		//否则都是安卓
		let result = await requestAndroidPermission('android.permission.ACCESS_FINE_LOCATION')
		return result === 1 ? true : false; //1:已获得授权		
	}
}

function androidBle() { //安卓手机蓝牙权限开启
	//安卓12蓝牙调用有问题，此处手动申请一下权限
	plus.android.requestPermissions(['android.permission.BLUETOOTH_SCAN', 'android.permission.BLUETOOTH_CONNECT'], function(e) {
		if (e.deniedAlways.length > 0) { //权限被永久拒绝
			// 弹出提示框解释为何需要定位权限，引导用户打开设置页面开启
			console.log('Always Denied!!! ' + e.deniedAlways.toString());
		}
		if (e.deniedPresent.length > 0) { //权限被临时拒绝
			// 弹出提示框解释为何需要定位权限，可再次调用plus.android.requestPermissions申请权限
			console.log('Present Denied!!! ' + e.deniedPresent.toString());
		}
		if (e.granted.length > 0) { //权限被允许
			//调用依赖获取定位权限的代码
			console.log('Granted!!! ' + e.granted.toString());
		}
	}, function(e) {
		console.log('Request Permissions error:' + JSON.stringify(e));
	});
	let main = plus.android.runtimeMainActivity();
	let BluetoothAdapter = plus.android.importClass("android.bluetooth.BluetoothAdapter");
	let BAdapter = new BluetoothAdapter.getDefaultAdapter();
	let receiver = plus.android.implements('io.dcloud.android.content.BroadcastReceiver', {
		onReceive: function(context, intent) { //实现onReceiver回调函数  
			plus.android.importClass(intent);
			main.unregisterReceiver(receiver);
		}
	});
	let IntentFilter = plus.android.importClass('android.content.IntentFilter');
	let filter = new IntentFilter();
	filter.addAction(BAdapter.ACTION_STATE_CHANGED); //监听蓝牙开关  
	main.registerReceiver(receiver, filter); //注册监听  
	// if (!BAdapter.isEnabled()) {//蓝牙关闭了
	// 	BAdapter.enable(); //启动蓝牙  
	// }
	// else {
	// 	BAdapter.disable();
	// }	
	return BAdapter;
}

function androidBleStatus() {
	//安卓手机蓝牙状态检测 打开或者关闭
	let BAdapter = androidBle();
	return BAdapter.isEnabled();
}

function androidBleEnable() {
	//安卓手机打开蓝牙
	let BAdapter = androidBle();
	if (!BAdapter.isEnabled()) { //蓝牙关闭了
		BAdapter.enable(); //启动蓝牙  
	}
}

function turnOn() { //跳转打开定位的开关系统设置
	if (isIos) {
		//苹果
		let UIApplication = plus.ios.import("UIApplication");
		let application2 = UIApplication.sharedApplication();
		let NSURL2 = plus.ios.import("NSURL");
		let setting2 = NSURL2.URLWithString("App-Prefs:root=Privacy&path=LOCATION");
		application2.openURL(setting2);
		plus.ios.deleteObject(setting2);
		plus.ios.deleteObject(NSURL2);
		plus.ios.deleteObject(application2);
	} else {
		//安卓
		let Intent = plus.android.importClass('android.content.Intent');
		let Settings = plus.android.importClass('android.provider.Settings');
		let intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
		let main = plus.android.runtimeMainActivity();
		main.startActivity(intent); // 打开系统设置GPS服务页面
	}
}

module.exports = {
	judgeIosPermission,
	requestAndroidPermission,
	checkSystemEnableLocation,
	gotoAppPermissionSetting,
	locationJur,
	androidBleStatus,
	androidBleEnable,
	turnOn,
}