import { Ionicons } from '@expo/vector-icons';
import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, RecordingPresets } from 'expo-audio';
import * as Contacts from 'expo-contacts';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes
} from 'firebase/storage';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { auth, db } from '../../api/firebase';

const getSafeTime = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

const LiveTimeCounter = ({ lastLogin }) => {
  const [timeOnline, setTimeOnline] = useState('Just now');

  useEffect(() => {
    if (!lastLogin) return;
    const updateTimer = () => {
      const startTime = getSafeTime(lastLogin);
      if (!startTime) { setTimeOnline('Just now'); return; }
      const diffMs = Date.now() - startTime;
      if (diffMs < 0) { setTimeOnline('Just now'); return; }
      const diffSec = Math.floor(diffMs / 1000);
      const mins = Math.floor(diffSec / 60);
      const hrs = Math.floor(mins / 60);
      const remainingSecs = diffSec % 60;
      const remainingMins = mins % 60;

      if (hrs > 0) setTimeOnline(`Online: ${hrs}h ${remainingMins}m`);
      else if (mins > 0) setTimeOnline(`Online: ${mins}m ${remainingSecs}s`);
      else if (diffSec > 0) setTimeOnline(`Online: ${diffSec}s`);
      else setTimeOnline('Just now');
    };
    updateTimer();
    const intervalId = setInterval(updateTimer, 1000);
    return () => clearInterval(intervalId);
  }, [lastLogin]);

  return <Text style={styles.userTime}>{timeOnline}</Text>;
};

const getEmptyOrder = () => ({ customer: '', deliveryAddress: '', driverName: '', items: [{ title: '', weight: '' }], pickupAddresses: [{ address: '' }] });

const resourceOptions = [
  { id: 'warehouses', label: 'Warehouses', icon: 'cube-outline', actions: ['view', 'create', 'edit', 'delete'] },
  { id: 'products', label: 'Products', icon: 'logo-dropbox', actions: ['view', 'create', 'edit', 'delete'] },
  { id: 'orders', label: 'Orders', icon: 'clipboard-outline', actions: ['view', 'create', 'edit', 'delete'] },
  { id: 'attendance', label: 'Attendance', icon: 'time-outline', actions: ['view'] },
  { id: 'chat', label: 'Chat', icon: 'chatbubble-outline', actions: ['send message', 'create room'] },
  { id: 'notifications', label: 'Notifications', icon: 'notifications-outline', actions: ['send message'] },
];

const editableFieldsList = ['Name', 'Email', 'Phone Number', 'Location'];

// 🔥 NEW: QUICK ACTIONS MENU WITH ICONS & COLORS 🔥
const quickActionsList = [
  { name: 'Orders', icon: 'clipboard-outline', color: '#4F46E5', bg: '#EEF2FF' },
  { name: 'Attendance', icon: 'calendar-outline', color: '#059669', bg: '#D1FAE5' },
  { name: 'Users', icon: 'people-outline', color: '#2563EB', bg: '#DBEAFE' },
  { name: 'Job Roles', icon: 'briefcase-outline', color: '#D97706', bg: '#FEF3C7' },
  { name: 'Warehouses', icon: 'cube-outline', color: '#7C3AED', bg: '#EDE9FE' },
  { name: 'Products', icon: 'pricetags-outline', color: '#DB2777', bg: '#FCE7F3' },
  { name: 'Chats', icon: 'chatbubbles-outline', color: '#0891B2', bg: '#CFFAFE' },
  { name: 'Send Alert', icon: 'notifications-outline', color: '#DC2626', bg: '#FEE2E2' },
  { name: 'Activity Logs', icon: 'shield-checkmark-outline', color: '#4B5563', bg: '#F3F4F6' },
];

// COMPONENT: Chat Message Bubble
const ChatMessageBubble = ({ message, isMe }) => {
  const formatMsgTime = (timestamp) => {
    if(!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  
  const handleDocDownload = () => {
    if(message.contentUrl) Alert.alert('Download Document', `Filename: ${message.filename}`);
  };

  const renderContent = () => {
    switch (message.type) {
      case 'text': return <Text style={[styles.msgText, isMe ? styles.msgTextMe : styles.msgTextThem]}>{message.text}</Text>;
      case 'image': return <Image source={{uri: message.contentUrl}} style={styles.msgImageContent} resizeMode="cover" />;
      case 'video': return <View style={styles.msgVideoContent}><Ionicons name="play-circle-outline" size={40} color="#6366F1" /><Text style={styles.msgVideoText}>Watch Video</Text></View>;
      case 'document': return (
        <TouchableOpacity style={styles.msgDocContent} onPress={handleDocDownload}>
          <Ionicons name="document-text-outline" size={24} color={isMe ? '#FFF' : '#6366F1'} style={{marginRight: 10}} />
          <Text style={[styles.msgDocText, isMe ? styles.msgTextMe : styles.msgTextThem]}>{message.filename || 'Document'}</Text>
        </TouchableOpacity>
      );
      case 'contact': return (
        <View style={styles.msgContactContent}>
          <Ionicons name="person-circle-outline" size={24} color="#6B7280" style={{marginRight: 10}}/>
          <View>
            <Text style={styles.msgContactName}>{message.contactData?.name || 'Contact'}</Text>
            <Text style={styles.msgContactPhone}>{message.contactData?.phone || 'No phone'}</Text>
          </View>
        </View>
      );
      case 'audio': return (
        <View style={styles.msgAudioContent}>
          <Ionicons name="play-circle-outline" size={28} color={isMe ? '#FFF' : '#6366F1'} style={{marginRight: 10}}/>
          <Text style={[styles.msgAudioText, isMe ? styles.msgTextMe : styles.msgTextThem]}>Voice Note</Text>
        </View>
      );
      default: return null;
    }
  };

  return (
    <View style={[styles.msgWrapper, isMe ? styles.msgWrapperMe : styles.msgWrapperThem]}>
      {!isMe && <Text style={styles.msgSenderName}>{message.senderName} ({message.senderRole})</Text>}
      <View style={[styles.msgBubble, isMe ? styles.msgBubbleMe : styles.msgBubbleThem]}>
        {renderContent()}
        <Text style={[styles.msgTime, isMe ? styles.msgTimeMe : styles.msgTimeThem]}>{formatMsgTime(message.createdAt)}</Text>
      </View>
    </View>
  );
};

export default function ManagerDashboard({ navigation }) {
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [stats, setStats] = useState({ active: 0, pending: 0, completed: 0 });
  const [activeUsers, setActiveUsers] = useState([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showEditUserModal, setShowEditUserModal] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [allUsersList, setAllUsersList] = useState([]); 
  const [editingUser, setEditingUser] = useState({ id: '', name: '', email: '', phone: '', role: '', location: '', password: '' });
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', phone: '', password: '', role: 'admin', location: '' });
  const [addUserErrors, setAddUserErrors] = useState({});

  const [showRolesModal, setShowRolesModal] = useState(false);
  const [showAddRoleModal, setShowAddRoleModal] = useState(false);
  const [rolesList, setRolesList] = useState([]);
  const [newRoleInput, setNewRoleInput] = useState('');
  const [newRolePermissions, setNewRolePermissions] = useState({});
  const [editingRoleId, setEditingRoleId] = useState(null);
  const [editRoleName, setEditRoleName] = useState('');

  const [showOrdersModal, setShowOrdersModal] = useState(false);
  const [showAddOrderModal, setShowAddOrderModal] = useState(false);
  const [activeOrderTab, setActiveOrderTab] = useState('Active');
  const [ordersList, setOrdersList] = useState([]);
  const [newOrder, setNewOrder] = useState(getEmptyOrder());

  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [selectedEntityForPerms, setSelectedEntityForPerms] = useState(null);
  const [activePermTab, setActivePermTab] = useState('Resources'); 
  const [expandedRes, setExpandedRes] = useState(null);
  const [entityPermissions, setEntityPermissions] = useState({ resources: {}, userManagement: { canManage: false, manageableRoles: [], editableFields: [] } });

  const [warehouses, setWarehouses] = useState([]);
  const [showWarehouseModal, setShowWarehouseModal] = useState(false);
  const [showAddWarehouseModal, setShowAddWarehouseModal] = useState(false);
  const [editingWarehouseId, setEditingWarehouseId] = useState(null);
  const [whName, setWhName] = useState('');
  const [whAddress, setWhAddress] = useState('');
  const [whMaterials, setWhMaterials] = useState([{ name: '', amount: '' }]);

  const [showContainerHistoryModal, setShowContainerHistoryModal] = useState(false);
  const [showAddContainerModal, setShowAddContainerModal] = useState(false);
  const [selectedWarehouseForContainers, setSelectedWarehouseForContainers] = useState(null);
  const [warehouseContainers, setWarehouseContainers] = useState([]);
  const [newContainer, setNewContainer] = useState({ number: '', seal: '', origin: '', notes: '' });
  const [containerImages, setContainerImages] = useState([]);

  const [allWorkers, setAllWorkers] = useState([]);
  const [selectedWorkerHistory, setSelectedWorkerHistory] = useState(null);
  const [historyData, setHistoryData] = useState([]);

  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState(null);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [deleteErrorText, setDeleteErrorText] = useState('');

  const [roleToDelete, setRoleToDelete] = useState(null);
  const [roleDeleteText, setRoleDeleteText] = useState('');
  const [roleDeleteError, setRoleDeleteError] = useState('');

  const [showProductsModal, setShowProductsModal] = useState(false);
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [productsList, setProductsList] = useState([]);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [newProduct, setNewProduct] = useState({ name: '', category: '', description: '', price: '', stock: '' }); 
  const [productImages, setProductImages] = useState([]); 
  const [isUploading, setIsUploading] = useState(false); 
  const [uploadError, setUploadError] = useState('');

  const [showChatListModal, setShowChatListModal] = useState(false);
  const [showCreateChatModal, setShowCreateChatModal] = useState(false);
  const [activeChatRoom, setActiveChatRoom] = useState(null);
  const [chatsList, setChatsList] = useState([]);
  const [messagesList, setMessagesList] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [newChatDetails, setNewChatDetails] = useState({ name: '', participants: [] });
  
  const [showEditParticipantsOverlay, setShowEditParticipantsOverlay] = useState(false); 
  const [showAttachMenu, setShowAttachMenu] = useState(false); 
  const [editChatParticipants, setEditChatParticipants] = useState([]); 
  const [showRenameOverlay, setShowRenameOverlay] = useState(false); 
  const [newChatNameInput, setNewChatNameInput] = useState(''); 
  const [showSettingsMenu, setShowSettingsMenu] = useState(false); 
  const [showContactPickerOverlay, setShowContactPickerOverlay] = useState(false); 
  const [showCameraPreviewOverlay, setShowCameraPreviewOverlay] = useState(false); 
  const [cameraPreviewUri, setCameraPreviewUri] = useState(null); 
  
  const [isRecording, setIsRecording] = useState(false); 
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const messageListRef = useRef(null);
  const [allPhoneContacts, setAllPhoneContacts] = useState([]); 

  const [activityLogs, setActivityLogs] = useState([]);
  const [showLogsModal, setShowLogsModal] = useState(false);

  // 🔥 NEW: NOTIFICATIONS/ALERTS STATES 🔥
  const [showAlertsModal, setShowAlertsModal] = useState(false);
  const [alertForm, setAlertForm] = useState({ title: '', message: '', targetType: 'all', targetValue: '' });
  const [isSendingAlert, setIsSendingAlert] = useState(false);

  // CORE GLOBAL LOGGING FUNCTION
  const logActivity = async (actionTitle, details = '') => {
    if (!auth.currentUser) return;
    try {
      await addDoc(collection(db, 'ActivityLogs'), {
        userId: auth.currentUser.uid,
        userName: currentUserProfile?.name || 'Admin',
        userRole: currentUserProfile?.role || 'admin',
        action: actionTitle,
        details: details,
        timestamp: serverTimestamp()
      });
    } catch (e) { console.log('Error saving log:', e); }
  };

  useEffect(() => {
    if (auth.currentUser) {
      getDoc(doc(db, 'Users', auth.currentUser.uid)).then(snap => {
        if(snap.exists()) setCurrentUserProfile({ id: snap.id, ...snap.data() });
      });
    }

    const unsubscribeOrders = onSnapshot(collection(db, 'Jobs'), (snapshot) => {
      let a = 0; let p = 0; let c = 0;
      const fetchedOrders = [];
      snapshot.forEach((jobDoc) => {
        const data = jobDoc.data();
        fetchedOrders.push({ id: jobDoc.id, ...data });
        if (data.status === 'Completed') c += 1;
        else if (data.status === 'Pending') p += 1;
        else if (data.status === 'Active') a += 1;
      });
      setOrdersList(fetchedOrders);
      setStats({ active: a, pending: p, completed: c });
    });

    const unsubscribeAllUsers = onSnapshot(collection(db, 'Users'), (snapshot) => {
      const users = [];
      const actives = [];
      snapshot.forEach((userDoc) => {
        const data = userDoc.data();
        if (data.role && data.role !== 'unassigned' && data.role !== 'rejected') {
          const u = { id: userDoc.id, name: data.name || 'Unknown', role: data.role, phone: data.phone, location: data.location, email: data.email, lastLogin: data.lastLogin, isOnline: data.isOnline };
          users.push(u);
          if (data.isOnline) actives.push(u);
        }
      });
      setAllUsersList(users);
      setActiveUsers(actives);
    });

    const unsubscribeWarehouses = onSnapshot(collection(db, 'Warehouses'), (snapshot) => {
      const whList = [];
      snapshot.forEach((warehouseDoc) => whList.push({ id: warehouseDoc.id, ...warehouseDoc.data() }));
      setWarehouses(whList);
    });

    const unsubscribeRoles = onSnapshot(collection(db, 'Roles'), (snapshot) => {
      const rList = [];
      let hasAdmin = false;
      snapshot.forEach((roleDoc) => {
        const data = roleDoc.data();
        const isAd = (data.name || '').toLowerCase() === 'admin';
        if (isAd) hasAdmin = true;
        rList.push({ id: roleDoc.id, name: data.name, isDefault: isAd, permissions: data.permissions || {} });
      });
      if (!hasAdmin) rList.unshift({ id: 'core_admin', name: 'admin', isDefault: true, permissions: {} });
      setRolesList(rList);
    });

    const unsubscribeProducts = onSnapshot(collection(db, 'Products'), (snapshot) => {
      const pList = [];
      snapshot.forEach((doc) => pList.push({ id: doc.id, ...doc.data() }));
      setProductsList(pList);
    });

    const unsubscribeChats = onSnapshot(collection(db, 'Chats'), (snapshot) => {
      const cList = [];
      snapshot.forEach((doc) => cList.push({ id: doc.id, ...doc.data() }));
      cList.sort((a,b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      setChatsList(cList);
    });

    const unsubscribeLogs = onSnapshot(query(collection(db, 'ActivityLogs'), orderBy('timestamp', 'desc')), (snapshot) => {
      const lList = [];
      snapshot.forEach((doc) => lList.push({ id: doc.id, ...doc.data() }));
      setActivityLogs(lList);
    });
    
    (async () => {
      if (Platform.OS !== 'web') {
        try {
          await requestRecordingPermissionsAsync();
          const contactsStatus = await Contacts.requestPermissionsAsync();
          if(contactsStatus.granted) {
              const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.Emails, Contacts.Fields.PhoneNumbers] });
              if (data.length > 0) { setAllPhoneContacts(data); }
          }
        } catch(e) {}
      }
    })();

    return () => { unsubscribeOrders(); unsubscribeAllUsers(); unsubscribeWarehouses(); unsubscribeRoles(); unsubscribeProducts(); unsubscribeChats(); unsubscribeLogs(); };
  }, []);

  useEffect(() => {
    if (!activeChatRoom) return;
    const msgRef = collection(db, `Chats/${activeChatRoom.id}/Messages`);
    const q = query(msgRef, orderBy('createdAt', 'asc')); 
    
    const unsubscribeMessages = onSnapshot(q, (snapshot) => {
      const mList = [];
      snapshot.forEach(doc => mList.push({ id: doc.id, ...doc.data() }));
      setMessagesList(mList);
    });
    return () => unsubscribeMessages();
  }, [activeChatRoom]);

  useEffect(() => {
    if (!selectedWarehouseForContainers) return;
    const containersRef = collection(db, `Warehouses/${selectedWarehouseForContainers.id}/Containers`);
    const q = query(containersRef, orderBy('receivedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const cList = [];
      snapshot.forEach(doc => cList.push({ id: doc.id, ...doc.data() }));
      setWarehouseContainers(cList);
    });
    return () => unsubscribe();
  }, [selectedWarehouseForContainers]);

  const handleLogout = async () => {
    try {
      if (auth.currentUser) {
        await logActivity('User Logout', 'User logged out of the system'); 
        await updateDoc(doc(db, 'Users', auth.currentUser.uid), { isOnline: false });
      }
      await auth.signOut();
      navigation.replace('Login');
    } catch (error) { Alert.alert('Error', 'Logout failed.'); }
  };

  const uploadMultimediaBlob = async (uri, pathPrefix) => {
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const storage = getStorage();
      const filename = `${pathPrefix}/${Date.now()}`;
      const storageRef = ref(storage, filename);
      await uploadBytes(storageRef, blob);
      return await getDownloadURL(storageRef);
    } catch (e) { 
      setUploadError('Failed to upload media. CORS or Network Error.');
      setTimeout(() => setUploadError(''), 4000);
      return null; 
    }
  };

  const handleOverviewClick = (tab) => { setActiveOrderTab(tab); setShowOrdersModal(true); setIsMenuOpen(false); };
  const resetOrderForm = () => setNewOrder(getEmptyOrder());
  const updateOrderItem = (index, field, value) => { setNewOrder((prev) => { const updated = [...prev.items]; updated[index] = { ...updated[index], [field]: value }; return { ...prev, items: updated }; }); };
  const addOrderItem = () => { setNewOrder((prev) => ({ ...prev, items: [...prev.items, { title: '', weight: '' }] })); };
  const removeOrderItem = (index) => { setNewOrder((prev) => { if (prev.items.length <= 1) return prev; return { ...prev, items: prev.items.filter((_, i) => i !== index) }; }); };
  const updatePickupAddress = (index, value) => { setNewOrder((prev) => { const updated = [...prev.pickupAddresses]; updated[index] = { ...updated[index], address: value }; return { ...prev, pickupAddresses: updated }; }); };
  const addPickupAddress = () => { setNewOrder((prev) => ({ ...prev, pickupAddresses: [...prev.pickupAddresses, { address: '' }] })); };
  const removePickupAddress = (index) => { setNewOrder((prev) => { if (prev.pickupAddresses.length <= 1) return prev; return { ...prev, pickupAddresses: prev.pickupAddresses.filter((_, i) => i !== index) }; }); };

  const handleAddOrder = async () => {
    const validItems = newOrder.items.map((item) => ({ title: (item.title || '').trim(), weight: (item.weight || '').trim() })).filter((item) => item.title || item.weight);
    const validPickupAddresses = newOrder.pickupAddresses.map((pickup) => ({ address: (pickup.address || '').trim() })).filter((pickup) => pickup.address);
    if (!newOrder.customer.trim() || validItems.length === 0 || validItems.some((item) => !item.title || !item.weight) || validPickupAddresses.length === 0 || !newOrder.deliveryAddress.trim() || !newOrder.driverName.trim()) {
      return Alert.alert('Validation Error', 'Please fill all required details.');
    }
    const orderTitleSummary = validItems.length === 1 ? validItems[0].title : `${validItems.length} Materials Order`;
    try {
      await addDoc(collection(db, 'Jobs'), { title: orderTitleSummary, customer: newOrder.customer.trim(), items: validItems, pickupAddresses: validPickupAddresses, address: validPickupAddresses[0]?.address || '', deliveryAddress: newOrder.deliveryAddress.trim(), driverName: newOrder.driverName.trim(), status: 'Active', createdAt: serverTimestamp() });
      await logActivity('Created Order', `Order assigned for ${newOrder.customer.trim()}`); 
      setShowAddOrderModal(false); resetOrderForm(); Alert.alert('Success', 'New order added.');
    } catch (e) { Alert.alert('Error', 'Could not add order.'); }
  };

  const updateOrderStatus = async (orderId, newStatus) => { 
    try { 
      await updateDoc(doc(db, 'Jobs', orderId), { status: newStatus }); 
      await logActivity('Updated Order Status', `Order status updated to ${newStatus}`); 
    } catch (e) { Alert.alert('Error', 'Could not update order status.'); } 
  };
  
  const confirmDeleteOrder = (order) => {
    if (order.status === 'Completed') { setOrderToDelete(order); setDeleteConfirmationText(''); setDeleteErrorText(''); setShowDeleteConfirmModal(true); } 
    else { Alert.alert('Delete Order', 'Are you sure?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { try { await deleteDoc(doc(db, 'Jobs', order.id)); await logActivity('Deleted Order', `Order for ${order.customer} was deleted`); Alert.alert('Success', 'Order deleted.'); } catch (e) {} } }]); } 
  };
  const executeCompletedOrderDelete = async () => {
    if (!orderToDelete) return;
    if (deleteConfirmationText.trim().toLowerCase() !== orderToDelete.customer.trim().toLowerCase()) { setDeleteErrorText('Name does not match.'); return; }
    try { await deleteDoc(doc(db, 'Jobs', orderToDelete.id)); await logActivity('Deleted Completed Order', `Order for ${orderToDelete.customer} was permanently deleted`); setShowDeleteConfirmModal(false); setOrderToDelete(null); setDeleteConfirmationText(''); Alert.alert('Success', 'Order deleted.'); } catch (e) { setDeleteErrorText('Failed to delete order.'); } 
  };

  const confirmDeleteRole = (role) => {
    if (role.name.toLowerCase() === 'admin' || role.id === 'core_admin') return Alert.alert('Denied', 'Admin role cannot be deleted.');
    setRoleToDelete(role); setRoleDeleteText(''); setRoleDeleteError('');
  };
  const executeRoleDelete = async () => {
    if (!roleToDelete) return;
    if (roleDeleteText.trim().toLowerCase() !== roleToDelete.name.trim().toLowerCase()) { setRoleDeleteError('Name does not match.'); return; }
    try { await deleteDoc(doc(db, 'Roles', roleToDelete.id)); await logActivity('Deleted Role', `Job Role ${roleToDelete.name} was deleted`); setRoleToDelete(null); setRoleDeleteText(''); Alert.alert('Success', 'Role deleted.'); } catch (e) { setRoleDeleteError('Failed to delete role.'); } 
  };

  const handleAddRole = async () => {
    const roleName = newRoleInput.trim();
    if (!roleName) return Alert.alert('Error', 'Please enter a role name.');
    const roleExists = rolesList.some(r => r.name.toLowerCase() === roleName.toLowerCase());
    if (roleName.toLowerCase() === 'admin' || roleExists) return Alert.alert('Error', 'Role exists.');
    try { await addDoc(collection(db, 'Roles'), { name: roleName, permissions: newRolePermissions, createdAt: serverTimestamp() }); await logActivity('Created Role', `New Job Role ${roleName} added`); setNewRoleInput(''); setNewRolePermissions({}); setExpandedRes(null); setShowAddRoleModal(false); Alert.alert('Success', 'Role created.'); } catch (e) { Alert.alert('Error', 'Could not add role.'); } 
  };

  const toggleNewRolePermission = (resourceId, action) => { setNewRolePermissions((prev) => { const currentResPerms = prev[resourceId] || {}; return { ...prev, [resourceId]: { ...currentResPerms, [action]: !currentResPerms[action] } }; }); };
  const saveRoleEdit = async (roleId) => { if (!editRoleName.trim()) return; try { await setDoc(doc(db, 'Roles', roleId), { name: editRoleName.trim().toLowerCase(), updatedAt: serverTimestamp() }, { merge: true }); await logActivity('Edited Role', `Role name updated to ${editRoleName.trim()}`); setEditingRoleId(null); setEditRoleName(''); } catch (e) {} }; 

  const activeRoles = rolesList.map((r) => r.name);

  const openUsersManagement = async () => { setIsMenuOpen(false); setSearchQuery(''); setShowUsersModal(true); };
  const handleDeleteUser = async (userId, userName) => { Alert.alert('Delete User', `Delete ${userName}?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Yes, Delete', style: 'destructive', onPress: async () => { try { await deleteDoc(doc(db, 'Users', userId)); await logActivity('Deleted User', `User profile for ${userName} removed`); } catch (e) {} } }]); }; 
  const openEditUserForm = (user) => { setEditingUser({ id: user.id, name: user.name || '', email: user.email || '', phone: user.phone || '', role: user.role, location: user.location || '', password: user.password || '' }); setShowEditPassword(false); setShowEditUserModal(true); };
  const saveUserEdit = async () => {
    if (!editingUser.name.trim() || !editingUser.email.trim() || !editingUser.password || editingUser.password.length < 6) return Alert.alert('Error', 'Ensure all fields are filled (Min 6 chars).');
    try {
      const updatedData = { name: editingUser.name.trim(), email: editingUser.email.trim(), phone: editingUser.phone.trim(), role: editingUser.role, location: editingUser.location.trim(), password: editingUser.password };
      await updateDoc(doc(db, 'Users', editingUser.id), updatedData);
      await logActivity('Edited User', `Updated profile data for ${editingUser.name.trim()}`); 
      setShowEditUserModal(false); Alert.alert('Success', 'User updated.');
    } catch (e) { Alert.alert('Error', 'Failed to update user.'); }
  };

  const openAddUserForm = () => { setNewUser({ name: '', email: '', phone: '', password: '', role: activeRoles.includes('admin') ? 'admin' : activeRoles[0], location: '' }); setAddUserErrors({}); setShowAddUserModal(true); };
  const ALLOWED_DOMAINS = ['gwgc.ca', 'greenwavepackaging.ca', 'greenwaverecycling.ca', 'greenwavehealth.ca'];
  const handleCreateNewUser = async () => {
    const errors = {};
    if (!newUser.name.trim()) errors.name = 'Full Name is required.';
    if (!newUser.phone.trim()) errors.phone = 'Phone Number is required.';
    if (!newUser.password) errors.password = 'Password is required.'; else if (newUser.password.length < 6) errors.password = 'Min 6 characters long.';
    if (!newUser.email.trim()) errors.email = 'Email Address is required.'; else { const emailParts = newUser.email.trim().split('@'); if (emailParts.length !== 2 || !ALLOWED_DOMAINS.includes(emailParts[1].toLowerCase())) errors.email = `Invalid domain.`; }
    if (Object.keys(errors).length > 0) return setAddUserErrors(errors);
    setAddUserErrors({});
    try {
      const apiKey = auth.app.options.apiKey;
      const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: newUser.email.trim(), password: newUser.password, returnSecureToken: true }) });
      const data = await res.json();
      if (data.error) return Alert.alert('Registration Failed', data.error.message);
      
      const newUid = data.localId;
      await setDoc(doc(db, 'Users', newUid), { name: newUser.name.trim(), email: newUser.email.trim(), phone: newUser.phone.trim(), password: newUser.password, role: newUser.role, location: newUser.location.trim(), isOnline: false, createdAt: serverTimestamp() });
      await logActivity('Created User', `Registered new user: ${newUser.name.trim()}`); 
      Alert.alert('Success', `${newUser.name} added successfully!`); setShowAddUserModal(false);
    } catch (error) { Alert.alert('Error', 'Could not create user.'); }
  };

  const openRolePermissionsModal = (role) => {
    setSelectedEntityForPerms({ id: role.id, name: role.name.toUpperCase(), subtitle: 'Role Template', type: 'role' });
    setEntityPermissions({ resources: role.permissions?.resources || {}, userManagement: role.permissions?.userManagement || { canManage: false, manageableRoles: [], editableFields: [] } });
    setExpandedRes(null); setActivePermTab('Resources'); setShowPermissionsModal(true);
  };
  const toggleResourcePermission = (resourceId, action) => { setEntityPermissions((prev) => { const currentResPerms = prev.resources[resourceId] || {}; return { ...prev, resources: { ...prev.resources, [resourceId]: { ...currentResPerms, [action]: !currentResPerms[action] } } }; }); };
  const toggleUserManagementMain = () => { setEntityPermissions((prev) => ({ ...prev, userManagement: { ...prev.userManagement, canManage: !prev.userManagement.canManage } })); };
  const toggleManageableRole = (roleName) => { setEntityPermissions((prev) => { const currentRoles = prev.userManagement.manageableRoles || []; const newRoles = currentRoles.includes(roleName) ? currentRoles.filter(r => r !== roleName) : [...currentRoles, roleName]; return { ...prev, userManagement: { ...prev.userManagement, manageableRoles: newRoles } }; }); };
  const toggleEditableField = (fieldName) => { setEntityPermissions((prev) => { const currentFields = prev.userManagement.editableFields || []; const newFields = currentFields.includes(fieldName) ? currentFields.filter(f => f !== fieldName) : [...currentFields, fieldName]; return { ...prev, userManagement: { ...prev.userManagement, editableFields: newFields } }; }); };
  const savePermissions = async () => { 
    try { 
      if (selectedEntityForPerms?.type === 'role') { 
        await updateDoc(doc(db, 'Roles', selectedEntityForPerms.id), { permissions: entityPermissions }); 
        setRolesList(rolesList.map((r) => r.id === selectedEntityForPerms.id ? { ...r, permissions: entityPermissions } : r)); 
        await logActivity('Updated Permissions', `Modified permissions for Role: ${selectedEntityForPerms.name}`); 
      } 
      Alert.alert('Success', 'Role permissions updated successfully.'); setShowPermissionsModal(false); 
    } catch (error) { Alert.alert('Error', 'Could not save permissions.'); } 
  };
  const resetPermissions = () => setEntityPermissions({ resources: {}, userManagement: { canManage: false, manageableRoles: [], editableFields: [] } });

  const openAttendance = async () => {
    try {
      setIsMenuOpen(false); setShowAttendanceModal(true); setSelectedWorkerHistory(null);
      setAllWorkers(allUsersList);
    } catch (error) { Alert.alert('Error', 'Failed to load attendance list.'); }
  };

  const fetchWorkerHistory = async (worker) => {
    setSelectedWorkerHistory(worker);
    const historyRef = collection(db, 'Users', worker.id, 'WorkHistory');
    const historySnap = await getDocs(historyRef);
    const normalizeDate = (dateStr) => {
      if (!dateStr) return null;
      if (dateStr.includes('/')) {
        const [d, m, y] = dateStr.split('/');
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
      return dateStr;
    };
    const mergedHistoryMap = {};
    historySnap.forEach((historyDoc) => {
      const data = historyDoc.data();
      const normDate = normalizeDate(data.date);
      if (normDate) {
        if (!mergedHistoryMap[normDate]) mergedHistoryMap[normDate] = { date: normDate, totalMinutes: 0, isOngoing: false };
        mergedHistoryMap[normDate].totalMinutes += (data.totalMinutes || 0);
      }
    });

    if (worker.isOnline && worker.lastLogin) {
      const startTime = getSafeTime(worker.lastLogin);
      if (startTime) {
        const diffMs = Date.now() - startTime;
        const totalMins = Math.max(0, Math.floor(diffMs / 60000));
        const today = new Date();
        const normToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        if (!mergedHistoryMap[normToday]) mergedHistoryMap[normToday] = { date: normToday, totalMinutes: 0, isOngoing: true };
        mergedHistoryMap[normToday].totalMinutes += totalMins;
        mergedHistoryMap[normToday].isOngoing = true;
      }
    }
    const finalHistory = Object.values(mergedHistoryMap);
    finalHistory.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setHistoryData(finalHistory);
  };
  
  const formatTime = (totalMins) => { const hours = Math.floor(totalMins / 60); const mins = totalMins % 60; return `${hours}h ${mins}m`; };

  // WAREHOUSE FUNCTIONS
  const handleAddMaterialRow = () => setWhMaterials([...whMaterials, { name: '', amount: '' }]);
  const handleMaterialChange = (text, index, field) => { const updatedMaterials = [...whMaterials]; updatedMaterials[index][field] = text; setWhMaterials(updatedMaterials); };
  const removeMaterialRow = (index) => { if (whMaterials.length > 1) { const updatedMaterials = whMaterials.filter((_, i) => i !== index); setWhMaterials(updatedMaterials); } };
  const openAddWarehouseForm = () => { setEditingWarehouseId(null); setWhName(''); setWhAddress(''); setWhMaterials([{ name: '', amount: '' }]); setShowAddWarehouseModal(true); };
  const openEditWarehouseForm = (warehouse) => { setEditingWarehouseId(warehouse.id); setWhName(warehouse.name); setWhAddress(warehouse.address || ''); setWhMaterials(warehouse.materials ? JSON.parse(JSON.stringify(warehouse.materials)) : [{ name: '', amount: '' }]); setShowAddWarehouseModal(true); };
  
  const saveWarehouse = async () => {
    if (!whName.trim() || !whAddress.trim()) return Alert.alert('Error', 'Warehouse Name and Address are required.');
    const validMaterials = whMaterials.filter((m) => m.name.trim() !== '' && m.amount.trim() !== '');
    if (validMaterials.length === 0) return Alert.alert('Error', 'Please add at least one material.');
    try {
      if (editingWarehouseId) { 
        await updateDoc(doc(db, 'Warehouses', editingWarehouseId), { name: whName.trim(), address: whAddress.trim(), materials: validMaterials }); 
        await logActivity('Updated Warehouse', `Warehouse ${whName.trim()} data updated`); 
        Alert.alert('Success', 'Warehouse updated successfully!'); 
      } 
      else { 
        await addDoc(collection(db, 'Warehouses'), { name: whName.trim(), address: whAddress.trim(), materials: validMaterials, createdAt: serverTimestamp() }); 
        await logActivity('Added Warehouse', `Created new warehouse: ${whName.trim()}`); 
        Alert.alert('Success', 'Warehouse added successfully!'); 
      }
      setShowAddWarehouseModal(false);
    } catch (e) { Alert.alert('Error', 'Could not save warehouse.'); }
  };

  const openWarehouseContainers = (warehouse) => {
    setSelectedWarehouseForContainers(warehouse);
    setShowContainerHistoryModal(true);
  };

  const pickContainerImages = async () => {
    if (containerImages.length >= 10) return Alert.alert('Limit', 'Max 10 images');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, selectionLimit: 10 - containerImages.length, quality: 0.6 });
    if (!result.canceled) {
      const selectedUris = result.assets.map(a => a.uri);
      setContainerImages(prev => [...prev, ...selectedUris].slice(0,10));
    }
  };

  const pickContainerCamera = async () => {
    if (containerImages.length >= 10) return Alert.alert('Limit', 'Max 10 images');
    if (Platform.OS === 'web') return Alert.alert("Not Supported", "Camera not supported on web.");
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!result.canceled) {
      setContainerImages(prev => [...prev, result.assets[0].uri]);
    }
  };

  const handleSaveContainer = async () => {
    const { number, seal, origin } = newContainer;
    if(!number.trim() || !seal.trim() || !origin.trim()) return Alert.alert("Error", "Please fill required details (Number, Seal, Origin).");
    if(!selectedWarehouseForContainers) return;

    setIsUploading(true); setUploadError('');
    try {
      const uploadedImageUrls = [];
      for(let i=0; i<containerImages.length; i++) {
        const downloadUrl = await uploadMultimediaBlob(containerImages[i], `warehouses/containers/${Date.now()}_${i}`);
        if(downloadUrl) uploadedImageUrls.push(downloadUrl);
      }

      await addDoc(collection(db, `Warehouses/${selectedWarehouseForContainers.id}/Containers`), {
        number: number.trim(),
        seal: seal.trim(),
        origin: origin.trim(),
        notes: newContainer.notes.trim(),
        images: uploadedImageUrls,
        receivedBy: currentUserProfile?.name || 'Admin',
        receivedAt: serverTimestamp()
      });

      await logActivity('Container Received', `Container ${number.trim()} logged at ${selectedWarehouseForContainers.name}`); 

      setIsUploading(false);
      setShowAddContainerModal(false);
      setNewContainer({ number: '', seal: '', origin: '', notes: '' });
      setContainerImages([]);
      Alert.alert("Success", "Container received and logged!");
    } catch(e) {
      setIsUploading(false);
      Alert.alert("Error", "Could not save container data.");
    }
  };

  const pickProductImages = async () => {
    if (productImages.length >= 10) { Alert.alert('Limit Reached', 'You can only upload up to 10 images.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, selectionLimit: 10 - productImages.length, quality: 0.7 });
    if (!result.canceled) {
      const selectedUris = result.assets.map(asset => asset.uri);
      const combined = [...productImages, ...selectedUris].slice(0, 10);
      setProductImages(combined);
    }
  };

  const pickProductPhotoViaCamera = async () => {
    if (productImages.length >= 10) { Alert.alert('Limit Reached', 'Max 10 images.'); return; }
    if (Platform.OS === 'web') return Alert.alert("Not Supported", "Web camera capture not supported.");
    
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return Alert.alert('Permission Denied', 'Camera permission required.');

    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled) {
        setProductImages(prev => [...prev, result.assets[0].uri]);
    }
  };

  const removeProductImage = (indexToRemove) => { setProductImages(prev => prev.filter((_, index) => index !== indexToRemove)); };

  const handleAddProduct = async () => {
    const { name, category, description, price, stock } = newProduct;
    if (!name.trim() || !category.trim() || !description.trim() || !price.trim() || !stock.trim()) { return Alert.alert('Validation Error', 'All product fields are required to publish.'); }
    setIsUploading(true); setUploadError('');
    try {
      const storage = getStorage();
      const uploadedImageUrls = [];
      for (let i = 0; i < productImages.length; i++) {
        const localUri = productImages[i];
        const filename = `products/${Date.now()}_${i}.jpg`;
        const storageRef = ref(storage, filename);
        const response = await fetch(localUri);
        const blob = await response.blob();
        await uploadBytes(storageRef, blob);
        const downloadUrl = await getDownloadURL(storageRef);
        uploadedImageUrls.push(downloadUrl);
      }
      await addDoc(collection(db, 'Products'), { name: name.trim(), category: category.trim(), description: description.trim(), price: price.trim(), stock: stock.trim(), images: uploadedImageUrls, createdAt: serverTimestamp() });
      await logActivity('Published Product', `New Product added: ${name.trim()}`); 
      setIsUploading(false); setShowAddProductModal(false); setNewProduct({ name: '', category: '', description: '', price: '', stock: '' }); setProductImages([]); Alert.alert('Success', 'Product listed successfully!');
    } catch (e) { 
      setIsUploading(false); 
      setUploadError('Failed to upload product images.');
      setTimeout(() => setUploadError(''), 3000);
    }
  };

  const deleteProduct = async (id) => {
    Alert.alert('Delete Product', 'Remove this product from the store?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => {
      await deleteDoc(doc(db, 'Products', id));
      await logActivity('Deleted Product', `Product ID: ${id} was removed`); 
    } }]);
  };


  const createParticipantData = (userId) => ({ userId, joinedAt: serverTimestamp() });

  const toggleCreateChatParticipant = (userId) => {
    setNewChatDetails(prev => {
      const current = prev.participants;
      if (current.includes(userId)) return { ...prev, participants: current.filter(id => id !== userId) };
      return { ...prev, participants: [...current, userId] };
    });
  };

  const handleCreateChatRoomSimple = async () => {
    if (!newChatDetails.name.trim()) return Alert.alert('Error', 'Please enter a branch or room name.');
    try {
      const finalParticipantIds = [...newChatDetails.participants];
      if (auth.currentUser && !finalParticipantIds.includes(auth.currentUser.uid)) finalParticipantIds.push(auth.currentUser.uid);
      
      const chatRoomDoc = await addDoc(collection(db, 'Chats'), {
        name: newChatDetails.name.trim(),
        participantIds: finalParticipantIds, 
        createdBy: auth.currentUser?.uid || 'admin',
        createdAt: serverTimestamp()
      });
      
      const participantsSubRef = collection(chatRoomDoc, 'ParticipantsAccess');
      for (const uid of finalParticipantIds) {
        await setDoc(doc(participantsSubRef, uid), createParticipantData(uid));
      }
      
      await logActivity('Created Chat Room', `Communication room created: ${newChatDetails.name.trim()}`); 
      setShowCreateChatModal(false); setNewChatDetails({ name: '', participants: [] });
    } catch (e) { Alert.alert('Error', 'Could not create chat room.'); }
  };
  
  const openParticipantEdit = (chatRoom) => {
    setEditChatParticipants(chatRoom.participantIds || []);
    setShowEditParticipantsOverlay(true);
  };
  
  const toggleEditParticipant = (userId) => {
    setEditChatParticipants(prev => {
      if (prev.includes(userId)) return prev.filter(id => id !== userId);
      return [...prev, userId];
    });
  };
  
  const saveParticipantEdits = async () => {
    if (!activeChatRoom) return;
    try {
      const chatDocRef = doc(db, 'Chats', activeChatRoom.id);
      const accessRef = collection(chatDocRef, 'ParticipantsAccess');
      const originalParticipantIds = activeChatRoom.participantIds || [];
      const newParticipantIds = editChatParticipants;
      
      const addedUsers = newParticipantIds.filter(uid => !originalParticipantIds.includes(uid));
      const removedUsers = originalParticipantIds.filter(uid => !newParticipantIds.includes(uid));
      
      await updateDoc(chatDocRef, { participantIds: newParticipantIds });
      
      for (const uid of addedUsers) { await setDoc(doc(accessRef, uid), createParticipantData(uid)); }
      for (const uid of removedUsers) { await deleteDoc(doc(accessRef, uid)); }
      
      await logActivity('Updated Chat Members', `Modified access for Chat Room: ${activeChatRoom.name}`); 
      setShowEditParticipantsOverlay(false); 
      Alert.alert('Success', 'Participants updated successfully!');
      setActiveChatRoom(prev => ({...prev, participantIds: newParticipantIds}));
    } catch (e) { Alert.alert('Error', 'Could not update participants.'); }
  };

  const sendMultimediaMessage = async (msgData) => {
    if (!activeChatRoom) return;
    const sId = currentUserProfile?.id || auth.currentUser?.uid || 'unknown';
    const sName = currentUserProfile?.name || 'Admin';
    const sRole = currentUserProfile?.role || 'admin';
    try {
      await addDoc(collection(db, `Chats/${activeChatRoom.id}/Messages`), {
        ...msgData,
        senderId: sId,
        senderName: sName,
        senderRole: sRole,
        createdAt: serverTimestamp()
      });
    } catch (e) { Alert.alert('Error', 'Message failed to send.'); }
  };

  const handleSendMessageText = async () => {
    if (!messageInput.trim() || !activeChatRoom) return;
    const msgText = messageInput.trim(); 
    setMessageInput(''); 
    await sendMultimediaMessage({ type: 'text', text: msgText });
  };
  
  const pickGalleryMultimedia = async () => {
    setShowAttachMenu(false);
    if(Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.granted === false) return Alert.alert('Permission Denied', 'Gallery access required.');
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, allowsEditing: true, quality: 0.6 });
    if (!result.canceled) {
      const localUri = result.assets[0].uri; 
      const fileExtension = localUri.split('.').pop().toLowerCase() || 'jpg';
      const isVideo = ['mp4', 'mov', 'avi', 'webm'].includes(fileExtension); 
      const typePrefix = isVideo ? 'videos' : 'images';
      setIsUploading(true); setUploadError('');
      const downloadUrl = await uploadMultimediaBlob(localUri, `chats/${activeChatRoom.id}/${typePrefix}`);
      if(downloadUrl) {
        await sendMultimediaMessage({ type: typePrefix.slice(0, -1), contentUrl: downloadUrl, filename: `File_${Date.now()}.${fileExtension}` });
      }
      setIsUploading(false);
    }
  };

  const pickCameraPhoto = async () => {
    setShowAttachMenu(false);
    if (Platform.OS === 'web') return Alert.alert("Feature Not Available", "Camera capture is only available on mobile apps.");
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return Alert.alert('Permission Denied', 'Camera permission required.');

    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled) {
      setCameraPreviewUri(result.assets[0].uri);
      setShowCameraPreviewOverlay(true);
    }
  };

  const confirmAndSendCapturedPhoto = async () => {
    if(!cameraPreviewUri || !activeChatRoom) return;
    const uriToUpload = cameraPreviewUri;
    setShowCameraPreviewOverlay(false); 
    setCameraPreviewUri(null); 
    setIsUploading(true); setUploadError('');
    const downloadUrl = await uploadMultimediaBlob(uriToUpload, `chats/${activeChatRoom.id}/images`);
    if(downloadUrl) { await sendMultimediaMessage({ type: 'image', contentUrl: downloadUrl }); }
    setIsUploading(false);
  };

  const pickDocumentFile = async () => {
    setShowAttachMenu(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.type === 'success' || result.assets) {
        const file = result.assets ? result.assets[0] : result;
        setIsUploading(true); setUploadError('');
        const downloadUrl = await uploadMultimediaBlob(file.uri, `chats/${activeChatRoom.id}/documents`);
        if(downloadUrl) {
          await sendMultimediaMessage({ type: 'document', contentUrl: downloadUrl, filename: file.name || 'Document File' });
        }
        setIsUploading(false);
      }
    } catch(e) {}
  };

  const pickContact = async () => {
    setShowAttachMenu(false);
    if (Platform.OS === 'web') {
        Alert.alert('Web Contact Sharing', 'Web browsers block contact access. Select a simulated contact:', [
            {text: 'Simulate ABC Contact', onPress: async () => await sendMultimediaMessage({ type: 'contact', contactData: {name: 'Rahul Sharma', phone: '+1 9876543210'} }) }, 
            {text: 'Cancel', style: 'cancel'}
        ]);
        return;
    }
    setShowContactPickerOverlay(true); 
  };

  const selectAndSendContact = async (contact) => {
    setShowContactPickerOverlay(false);
    if (!contact) return;
    const phone = contact.phoneNumbers?.[0]?.number || 'No phone number available';
    await sendMultimediaMessage({ type: 'contact', contactData: {name: contact.name, phone} });
  };
  
  const startRecordingAudio = async () => {
    setShowAttachMenu(false); 
    if (Platform.OS === 'web') return Alert.alert("Feature Not Available", "Voice recording is only available on mobile apps.");
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setIsRecording(true);
    } catch {
      Alert.alert('Error', 'Could not start recording mic.');
    }
  };

  const stopAndSendRecording = async () => {
    try {
      setIsRecording(false);
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      if (!uri) return;
      setIsUploading(true);
      setUploadError('');
      const downloadUrl = await uploadMultimediaBlob(uri, `chats/${activeChatRoom.id}/audio`);
      if (downloadUrl) {
        await sendMultimediaMessage({ type: 'audio', contentUrl: downloadUrl });
      }
      setIsUploading(false);
    } catch {
      Alert.alert('Error', 'Recording failed to send.');
      setIsRecording(false);
    }
  };
  
  const cancelRecordingAudio = async () => {
    try {
      setIsRecording(false);
      await audioRecorder.stop();
    } catch {
      setIsRecording(false);
    }
  };

  const handleRenameChat = async () => {
    if(!activeChatRoom || !newChatNameInput.trim()) return;
    try {
        await updateDoc(doc(db, 'Chats', activeChatRoom.id), { name: newChatNameInput.trim() });
        await logActivity('Renamed Chat', `Chat name updated to ${newChatNameInput.trim()}`); 
        setShowRenameOverlay(false); 
        setActiveChatRoom(prev => ({...prev, name: newChatNameInput.trim()}));
    } catch(e) { Alert.alert('Error', 'Could not rename chat.'); }
  };

  // 🔥 NEW ALERT SENDING FUNCTION 🔥
  const handleSendAlert = async () => {
    if (!alertForm.title.trim() || !alertForm.message.trim()) return Alert.alert('Error', 'Title and message are required.');
    if (alertForm.targetType === 'role' && !alertForm.targetValue) return Alert.alert('Error', 'Please select a role.');
    if (alertForm.targetType === 'user' && !alertForm.targetValue) return Alert.alert('Error', 'Please select a specific worker.');

    setIsSendingAlert(true);
    try {
      await addDoc(collection(db, 'Alerts'), {
        title: alertForm.title.trim(),
        message: alertForm.message.trim(),
        targetType: alertForm.targetType,
        targetValue: alertForm.targetType === 'all' ? 'all' : alertForm.targetValue,
        createdBy: auth.currentUser.uid,
        createdAt: serverTimestamp()
      });
      await logActivity('Sent Alert', `Broadcasted notification to ${alertForm.targetType}: ${alertForm.title}`);
      setShowAlertsModal(false);
      setAlertForm({ title: '', message: '', targetType: 'all', targetValue: '' });
      Alert.alert('Success', 'Notification sent successfully!');
    } catch (e) {
      Alert.alert('Error', 'Failed to send notification.');
    } finally {
      setIsSendingAlert(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      {/* 🔥 NEW ALERTS/NOTIFICATIONS MODAL 🔥 */}
      <Modal visible={showAlertsModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowAlertsModal(false)}><Ionicons name="close" size={28} color="#111827" /></TouchableOpacity>
            <View style={{flex: 1, marginLeft: 15}}>
               <Text style={styles.modalTitle}>Send Notification</Text>
               <Text style={styles.chatHeaderSub}>Broadcast alerts to your staff</Text>
            </View>
          </View>
          <ScrollView style={{ padding: 20 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.formSection}>
              <Text style={styles.inputLabel}>Alert Title *</Text>
              <TextInput style={styles.textInput} placeholder="e.g. Urgent Meeting, Holiday Info" value={alertForm.title} onChangeText={t => setAlertForm({...alertForm, title: t})} />
              
              <Text style={[styles.inputLabel, {marginTop: 15}]}>Message *</Text>
              <TextInput style={[styles.textInput, {height: 100, textAlignVertical: 'top'}]} placeholder="Type your detailed message here..." multiline={true} value={alertForm.message} onChangeText={t => setAlertForm({...alertForm, message: t})} />
            </View>

            <View style={styles.formSection}>
              <Text style={styles.formSectionTitle}>Who should receive this?</Text>
              <View style={{flexDirection: 'row', marginBottom: 20}}>
                <TouchableOpacity style={[styles.targetTab, alertForm.targetType === 'all' && styles.targetTabActive]} onPress={() => setAlertForm({...alertForm, targetType: 'all', targetValue: ''})}>
                  <Text style={[styles.targetTabText, alertForm.targetType === 'all' && styles.targetTabTextActive]}>Everyone</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.targetTab, alertForm.targetType === 'role' && styles.targetTabActive]} onPress={() => setAlertForm({...alertForm, targetType: 'role', targetValue: ''})}>
                  <Text style={[styles.targetTabText, alertForm.targetType === 'role' && styles.targetTabTextActive]}>By Role</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.targetTab, alertForm.targetType === 'user' && styles.targetTabActive]} onPress={() => setAlertForm({...alertForm, targetType: 'user', targetValue: ''})}>
                  <Text style={[styles.targetTabText, alertForm.targetType === 'user' && styles.targetTabTextActive]}>Specific Worker</Text>
                </TouchableOpacity>
              </View>

              {alertForm.targetType === 'role' && (
                <View>
                  <Text style={styles.inputLabel}>Select Job Role:</Text>
                  <View style={styles.chipRowGrid}>
                    {rolesList.map(role => (
                      <TouchableOpacity key={role.id} style={[styles.permGridChip, alertForm.targetValue === role.name && styles.permChipActive]} onPress={() => setAlertForm({...alertForm, targetValue: role.name})}>
                        <Text style={[styles.permChipText, alertForm.targetValue === role.name && styles.permChipTextActive]}>{role.name.toUpperCase()}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {alertForm.targetType === 'user' && (
                <View>
                  <Text style={styles.inputLabel}>Select Worker:</Text>
                  <ScrollView style={{maxHeight: 200, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8}} nestedScrollEnabled>
                    {allUsersList.map(u => (
                      <TouchableOpacity key={u.id} style={{padding: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', backgroundColor: alertForm.targetValue === u.id ? '#EEF2FF' : '#FFF'}} onPress={() => setAlertForm({...alertForm, targetValue: u.id})}>
                        <Text style={{fontWeight: alertForm.targetValue === u.id ? 'bold' : 'normal', color: alertForm.targetValue === u.id ? '#4F46E5' : '#111827'}}>{u.name} ({u.role})</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            <TouchableOpacity style={styles.saveWhBtn} onPress={handleSendAlert} disabled={isSendingAlert}>
              {isSendingAlert ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveWhBtnText}>Broadcast Alert</Text>}
            </TouchableOpacity>
            <View style={{height: 40}}/>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={showLogsModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowLogsModal(false)}><Ionicons name="close" size={28} color="#111827" /></TouchableOpacity>
            <View style={{flex: 1, marginLeft: 15}}>
               <Text style={styles.modalTitle}>System Activity Logs</Text>
               <Text style={styles.chatHeaderSub}>Audit Trail for the entire application</Text>
            </View>
          </View>
          <ScrollView style={{ padding: 20 }} showsVerticalScrollIndicator={false}>
            {activityLogs.length === 0 ? <Text style={styles.emptyText}>No activity logged yet.</Text> : activityLogs.map(log => (
              <View key={log.id} style={styles.logCard}>
                <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 5}}>
                  <Ionicons name="shield-checkmark" size={16} color="#4F46E5" style={{marginRight: 6}}/>
                  <Text style={styles.logAction}>{log.action}</Text>
                </View>
                {log.details ? <Text style={styles.logDetails}>{log.details}</Text> : null}
                <View style={styles.logMetaRow}>
                  <Text style={styles.logUser}><Ionicons name="person" size={10}/> {log.userName} ({log.userRole.toUpperCase()})</Text>
                  <Text style={styles.logTime}>{log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : 'Just now'}</Text>
                </View>
              </View>
            ))}
            <View style={{height: 40}}/>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* ORDERS MODAL */}
      <Modal visible={showOrdersModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
          {showDeleteConfirmModal && (
            <View style={[StyleSheet.absoluteFill, styles.modalOverlay, { zIndex: 1000, elevation: 1000 }]}>
              <View style={styles.deleteConfirmBox}>
                <View style={styles.deleteHeaderRow}>
                   <Text style={styles.deleteModalTitle}>Confirm Delete</Text>
                   <TouchableOpacity onPress={() => setShowDeleteConfirmModal(false)}><Ionicons name="close" size={24} color="#111827"/></TouchableOpacity>
                </View>
                <Text style={styles.deleteModalDesc}>This order is <Text style={{fontWeight:'bold', color:'#10B981'}}>Completed</Text>. To prevent accidental deletion, please type the exact Customer Name: <Text style={{fontWeight: 'bold'}}> {orderToDelete?.customer}</Text></Text>
                <TextInput style={[styles.textInput, {marginTop: 15, borderColor: deleteErrorText ? '#EF4444' : '#E5E7EB'}]} placeholder="Type customer name here..." value={deleteConfirmationText} onChangeText={(text) => { setDeleteConfirmationText(text); setDeleteErrorText(''); }} />
                {!!deleteErrorText && <Text style={styles.errorText}>{deleteErrorText}</Text>}
                <TouchableOpacity style={[styles.saveWhBtn, {backgroundColor: '#EF4444', marginTop: 20}]} onPress={executeCompletedOrderDelete}><Text style={styles.saveWhBtnText}>Delete Permanently</Text></TouchableOpacity>
              </View>
            </View>
          )}
          <View style={styles.userListHeaderContainer}>
            <TouchableOpacity onPress={() => setShowOrdersModal(false)} style={{ marginBottom: 10 }}><Ionicons name="arrow-back" size={26} color="#111827" /></TouchableOpacity>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View><Text style={styles.permHeaderSubtitle}>GREENWAVE ADMIN</Text><Text style={styles.permHeaderTitle}>Order Management</Text></View><TouchableOpacity style={styles.addUserBtnOutline} onPress={() => { resetOrderForm(); setShowAddOrderModal(true); }}><Ionicons name="add" size={18} color="#6366F1" /><Text style={styles.addUserBtnText}>Add Order</Text></TouchableOpacity></View>
          </View>
          <View style={styles.permTabsRow}>
            {['Active', 'Pending', 'Completed'].map((tab) => (
              <TouchableOpacity key={tab} style={[styles.permTab, activeOrderTab === tab && styles.permTabActive]} onPress={() => setActiveOrderTab(tab)}>
                {tab === 'Active' && <Ionicons name="clipboard-outline" size={16} color={activeOrderTab === tab ? '#4F46E5' : '#9CA3AF'} style={{ marginRight: 5 }} />}
                {tab === 'Pending' && <Ionicons name="time-outline" size={16} color={activeOrderTab === tab ? '#F59E0B' : '#9CA3AF'} style={{ marginRight: 5 }} />}
                {tab === 'Completed' && <Ionicons name="checkmark-circle-outline" size={16} color={activeOrderTab === tab ? '#10B981' : '#9CA3AF'} style={{ marginRight: 5 }} />}
                <Text style={[styles.permTabText, activeOrderTab === tab && styles.permTabTextActive]}>{tab} ({ordersList.filter((o) => o.status === tab).length})</Text>
              </TouchableOpacity>
            ))}
          </View>
          <ScrollView style={{ padding: 20 }} showsVerticalScrollIndicator={false}>
            {ordersList.filter((o) => o.status === activeOrderTab).length === 0 ? <Text style={styles.emptyText}>No {activeOrderTab} orders right now.</Text> : ordersList.filter((o) => o.status === activeOrderTab).map((order) => (
                  <View key={order.id} style={styles.orderCard}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <Text style={styles.orderTitle}>{order.title}</Text>
                        {!!order.customer && <View style={styles.orderMetaRow}><Ionicons name="person-outline" size={14} color="#6B7280" /><Text style={styles.orderSubtitle}> {order.customer}</Text></View>}
                        {!!order.driverName && <View style={styles.orderMetaRow}><Ionicons name="car-outline" size={14} color="#6B7280" /><Text style={styles.orderSubtitle}> Driver: {order.driverName}</Text></View>}
                        {!!order.deliveryAddress && <View style={styles.orderMetaRow}><Ionicons name="navigate-outline" size={14} color="#6B7280" /><Text style={styles.orderSubtitle}> Delivery: {order.deliveryAddress}</Text></View>}
                        {!order.pickupAddresses?.length && !!order.address && <View style={styles.orderMetaRow}><Ionicons name="location-outline" size={14} color="#6B7280" /><Text style={styles.orderSubtitle}> Pickup: {order.address}</Text></View>}
                      </View>
                      <TouchableOpacity onPress={() => confirmDeleteOrder(order)} style={{ padding: 5 }}><Ionicons name="trash-outline" size={20} color="#EF4444" /></TouchableOpacity>
                    </View>
                    {order.items?.length ? (
                      <View style={styles.orderInfoBlock}><Text style={styles.orderSectionTitle}>Materials / Weight</Text>{order.items.map((item, idx) => (<View key={`${order.id}-item-${idx}`} style={styles.orderListRow}><View style={styles.orderListDot} /><Text style={styles.orderListText}>{item.title} {item.weight ? `- ${item.weight}` : ''}</Text></View>))}</View>
                    ) : null}
                    {order.pickupAddresses?.length ? (
                      <View style={styles.orderInfoBlock}><Text style={styles.orderSectionTitle}>Pickup Addresses</Text>{order.pickupAddresses.map((pickup, idx) => (<View key={`${order.id}-pickup-${idx}`} style={styles.orderListRow}><View style={styles.orderListDot} /><Text style={styles.orderListText}>{pickup.address}</Text></View>))}</View>
                    ) : null}
                    <View style={styles.orderActionRow}>
                      {activeOrderTab === 'Active' && <TouchableOpacity style={styles.startBtn} onPress={() => updateOrderStatus(order.id, 'Pending')}><Ionicons name="play-outline" size={16} color="#D97706" style={{ marginRight: 5 }} /><Text style={styles.startBtnText}>Start Order</Text></TouchableOpacity>}
                      {activeOrderTab === 'Pending' && <TouchableOpacity style={styles.completeBtn} onPress={() => updateOrderStatus(order.id, 'Completed')}><Ionicons name="checkmark-done-outline" size={16} color="#10B981" style={{ marginRight: 5 }} /><Text style={styles.completeBtnText}>Confirm Complete</Text></TouchableOpacity>}
                      {activeOrderTab === 'Completed' && <Text style={{ color: '#10B981', fontWeight: 'bold', fontSize: 13 }}>Successfully Delivered</Text>}
                    </View>
                  </View>
                ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={showAddOrderModal} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.addWhBox, { maxHeight: '90%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 }}><Text style={styles.drawerTitle}>Create New Order</Text><TouchableOpacity onPress={() => setShowAddOrderModal(false)}><Ionicons name="close" size={26} color="#111827" /></TouchableOpacity></View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.inputLabel}>Client / Customer Name *</Text><TextInput style={styles.textInput} placeholder="e.g. ABC Factory" value={newOrder.customer} onChangeText={(t) => setNewOrder({ ...newOrder, customer: t })} />
              <Text style={[styles.inputLabel, { marginTop: 18 }]}>Materials / Order Titles with Weight *</Text>
              {newOrder.items.map((item, index) => (
                <View key={`item-${index}`} style={styles.repeatCard}>
                  <Text style={styles.smallLabel}>Material / Order Title *</Text><TextInput style={styles.textInput} placeholder={`Material ${index + 1}`} value={item.title} onChangeText={(value) => updateOrderItem(index, 'title', value)} />
                  <Text style={[styles.smallLabel, { marginTop: 12 }]}>Weight *</Text><TextInput style={styles.textInput} placeholder="e.g. 500 kg" value={item.weight} onChangeText={(value) => updateOrderItem(index, 'weight', value)} />
                  {newOrder.items.length > 1 && <TouchableOpacity style={styles.removeMiniBtn} onPress={() => removeOrderItem(index)}><Ionicons name="trash-outline" size={16} color="#EF4444" /><Text style={styles.removeMiniBtnText}>Remove Material</Text></TouchableOpacity>}
                </View>
              ))}
              <TouchableOpacity style={styles.addMoreBtn} onPress={addOrderItem}><Ionicons name="add" size={18} color="#4F46E5" /><Text style={styles.addMoreText}>Add Material + Weight</Text></TouchableOpacity>
              <Text style={[styles.inputLabel, { marginTop: 18 }]}>Pickup Addresses *</Text>
              {newOrder.pickupAddresses.map((pickup, index) => (
                <View key={`pickup-${index}`} style={styles.repeatCard}>
                  <Text style={styles.smallLabel}>Pickup Address {index + 1}</Text><TextInput style={styles.textInput} placeholder={`Pickup address ${index + 1}`} value={pickup.address} onChangeText={(value) => updatePickupAddress(index, value)} />
                  {newOrder.pickupAddresses.length > 1 && <TouchableOpacity style={styles.removeMiniBtn} onPress={() => removePickupAddress(index)}><Ionicons name="trash-outline" size={16} color="#EF4444" /><Text style={styles.removeMiniBtnText}>Remove Pickup Address</Text></TouchableOpacity>}
                </View>
              ))}
              <TouchableOpacity style={styles.addMoreBtn} onPress={addPickupAddress}><Ionicons name="add" size={18} color="#4F46E5" /><Text style={styles.addMoreText}>Add Pickup Address</Text></TouchableOpacity>
              <Text style={[styles.inputLabel, { marginTop: 18 }]}>Delivery Address *</Text><TextInput style={styles.textInput} placeholder="e.g. Final delivery location" value={newOrder.deliveryAddress} onChangeText={(t) => setNewOrder({ ...newOrder, deliveryAddress: t })} />
              <Text style={[styles.inputLabel, { marginTop: 18 }]}>Driver Name *</Text><TextInput style={styles.textInput} placeholder="e.g. Aman Singh" value={newOrder.driverName} onChangeText={(t) => setNewOrder({ ...newOrder, driverName: t })} />
              <TouchableOpacity style={styles.saveWhBtn} onPress={handleAddOrder}><Text style={styles.saveWhBtnText}>Add to Active List</Text></TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* MANAGE JOB ROLES MODAL */}
      <Modal visible={showRolesModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
          {roleToDelete && (
            <View style={[StyleSheet.absoluteFill, styles.modalOverlay, { zIndex: 1000, elevation: 1000 }]}>
              <View style={styles.deleteConfirmBox}>
                <View style={styles.deleteHeaderRow}><Text style={styles.deleteModalTitle}>Confirm Delete</Text><TouchableOpacity onPress={() => setRoleToDelete(null)}><Ionicons name="close" size={24} color="#111827"/></TouchableOpacity></View>
                <Text style={styles.deleteModalDesc}>To prevent accidental deletion, please type the exact Role Name: <Text style={{fontWeight: 'bold'}}> {roleToDelete.name}</Text></Text>
                <TextInput style={[styles.textInput, {marginTop: 15, borderColor: roleDeleteError ? '#EF4444' : '#E5E7EB'}]} placeholder="Type role name here..." value={roleDeleteText} onChangeText={(text) => { setRoleDeleteText(text); setRoleDeleteError(''); }} />
                {!!roleDeleteError && <Text style={styles.errorText}>{roleDeleteError}</Text>}
                <TouchableOpacity style={[styles.saveWhBtn, {backgroundColor: '#EF4444', marginTop: 20}]} onPress={executeRoleDelete}><Text style={styles.saveWhBtnText}>Delete Permanently</Text></TouchableOpacity>
              </View>
            </View>
          )}
          <View style={styles.userListHeaderContainer}>
            <TouchableOpacity onPress={() => setShowRolesModal(false)} style={{ marginBottom: 10 }}><Ionicons name="arrow-back" size={26} color="#111827" /></TouchableOpacity>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View><Text style={styles.permHeaderSubtitle}>GREENWAVE ADMIN</Text><Text style={styles.permHeaderTitle}>Job Roles</Text></View><TouchableOpacity style={styles.addUserBtnOutline} onPress={() => { setNewRoleInput(''); setNewRolePermissions({}); setExpandedRes(null); setShowAddRoleModal(true); }}><Ionicons name="add" size={18} color="#6366F1" /><Text style={styles.addUserBtnText}>Add Role</Text></TouchableOpacity></View>
          </View>
          <ScrollView style={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.permSectionLabel}>AVAILABLE ROLES</Text>
            <View style={{ marginTop: 10 }}>
              {rolesList.length === 0 ? <Text style={styles.emptyText}>Loading...</Text> : rolesList.map((role) => (
                  <View key={role.id} style={styles.customUserCard}>
                    {editingRoleId === role.id ? (
                      <View style={{ flexDirection: 'row', flex: 1, alignItems: 'center' }}><TextInput style={[styles.textInput, { flex: 1, paddingVertical: 8 }]} value={editRoleName} onChangeText={setEditRoleName} autoFocus /><TouchableOpacity onPress={() => saveRoleEdit(role.id)} style={{ marginLeft: 15 }}><Ionicons name="checkmark-circle" size={32} color="#2E7D32" /></TouchableOpacity><TouchableOpacity onPress={() => setEditingRoleId(null)} style={{ marginLeft: 10 }}><Ionicons name="close-circle" size={32} color="#E53935" /></TouchableOpacity></View>
                    ) : (
                      <>
                        <View style={styles.customUserCardTop}><View style={[styles.customUserIconBox, { backgroundColor: role.isDefault ? '#EEF2FF' : '#F3F4F6' }]}><Ionicons name={role.isDefault ? 'shield-checkmark-outline' : 'briefcase-outline'} size={24} color={role.isDefault ? '#4F46E5' : '#6B7280'} /></View><View style={styles.customUserInfo}><Text style={styles.customUserName}>{role.name.toUpperCase()}</Text><Text style={styles.customUserEmail}>{role.isDefault ? 'Core System Role' : 'Custom Added Role'}</Text></View></View>
                        <View style={styles.drawerDivider} />
                        <View style={styles.customUserBottomRow}><TouchableOpacity onPress={() => { setEditingRoleId(role.id); setEditRoleName(role.name); }} style={styles.customActionBtnEdit}><Ionicons name="pencil-outline" size={16} color="#6366F1" style={{ marginRight: 4 }} /><Text style={styles.customActionBtnTextEdit}>Edit</Text></TouchableOpacity>{!role.isDefault && <TouchableOpacity onPress={() => confirmDeleteRole(role)} style={styles.customActionBtnDelete}><Ionicons name="trash-outline" size={16} color="#EF4444" style={{ marginRight: 4 }} /><Text style={styles.customActionBtnTextDelete}>Delete</Text></TouchableOpacity>}{role.name.toLowerCase() !== 'admin' && <TouchableOpacity onPress={() => openRolePermissionsModal(role)} style={styles.customActionBtnPerm}><Ionicons name="key-outline" size={16} color="#F59E0B" style={{ marginRight: 4 }} /><Text style={styles.customActionBtnTextPerm}>Permissions</Text></TouchableOpacity>}</View>
                      </>
                    )}
                  </View>
                ))}
            </View>
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={showAddRoleModal} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.addWhBox, { maxHeight: '90%' }]}><View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}><Text style={styles.drawerTitle}>Create New Role</Text><TouchableOpacity onPress={() => setShowAddRoleModal(false)}><Ionicons name="close" size={26} color="#111827" /></TouchableOpacity></View><ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"><Text style={styles.inputLabel}>Role Name *</Text><TextInput style={styles.textInput} placeholder="e.g. Supervisor, Helper" value={newRoleInput} onChangeText={setNewRoleInput} /><TouchableOpacity style={styles.saveWhBtn} onPress={handleAddRole}><Text style={styles.saveWhBtnText}>Create Role</Text></TouchableOpacity></ScrollView></View>
        </View>
      </Modal>

      <Modal visible={showPermissionsModal} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
          <View style={styles.permHeader}><TouchableOpacity onPress={() => setShowPermissionsModal(false)} style={{ padding: 5 }}><Ionicons name="arrow-back" size={26} color="#111827" /></TouchableOpacity><View style={{ marginLeft: 15 }}><Text style={styles.permHeaderSubtitle}>GREENWAVE ADMIN</Text><Text style={styles.permHeaderTitle}>Manage Permissions</Text><Text style={styles.permHeaderUser}>{selectedEntityForPerms?.name} • {selectedEntityForPerms?.subtitle}</Text></View></View>
          <View style={styles.permActionRow}><TouchableOpacity style={styles.permRoleBtn}><Ionicons name="document-text-outline" size={16} color="#4F46E5" /><Text style={styles.permRoleBtnText}>Role Template</Text></TouchableOpacity><TouchableOpacity style={styles.permResetBtn} onPress={resetPermissions}><Ionicons name="refresh-outline" size={16} color="#6B7280" /><Text style={styles.permResetBtnText}>Reset</Text></TouchableOpacity></View>
          <View style={styles.permTabsRow}>
            <TouchableOpacity style={[styles.permTab, activePermTab === 'Resources' && styles.permTabActive]} onPress={() => setActivePermTab('Resources')}><Ionicons name="cube-outline" size={16} color={activePermTab === 'Resources' ? '#4F46E5' : '#9CA3AF'} style={{marginRight:5}}/><Text style={[styles.permTabText, activePermTab === 'Resources' && styles.permTabTextActive]}>Resources</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.permTab, activePermTab === 'Users' && styles.permTabActive]} onPress={() => setActivePermTab('Users')}><Ionicons name="people-outline" size={16} color={activePermTab === 'Users' ? '#4F46E5' : '#9CA3AF'} style={{marginRight:5}}/><Text style={[styles.permTabText, activePermTab === 'Users' && styles.permTabTextActive]}>Users</Text></TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1, paddingHorizontal: 20, paddingTop: 15 }} showsVerticalScrollIndicator={false}>
            {activePermTab === 'Resources' ? (
              <>
                <Text style={styles.permSectionLabel}>RESOURCE PERMISSIONS</Text><Text style={styles.permSectionSubLabel}>Select actions for each resource</Text>
                {resourceOptions.map((res) => (
                  <View key={res.id} style={styles.accordionContainer}>
                    <TouchableOpacity style={styles.accordionHeader} onPress={() => setExpandedRes(expandedRes === res.id ? null : res.id)} activeOpacity={0.7}><View style={{ flexDirection: 'row', alignItems: 'center' }}><Ionicons name={res.icon} size={22} color="#4F46E5" style={{ marginRight: 15 }} /><Text style={styles.accordionTitle}>{res.label}</Text></View><Ionicons name={expandedRes === res.id ? 'chevron-down' : 'chevron-forward'} size={20} color="#9CA3AF" /></TouchableOpacity>
                    {expandedRes === res.id && (
                      <View style={styles.accordionBody}>
                        {res.actions.map((action) => {
                          const isChecked = entityPermissions.resources?.[res.id]?.[action] || false;
                          return (<TouchableOpacity key={action} style={styles.permOptionRow} onPress={() => toggleResourcePermission(res.id, action)} activeOpacity={0.7}><Ionicons name={isChecked ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={isChecked ? '#4F46E5' : '#D1D5DB'} style={{ marginRight: 12 }} /><Text style={[styles.permOptionText, isChecked && { color: '#111827', fontWeight: 'bold' }]}>{action}</Text></TouchableOpacity>);
                        })}
                      </View>
                    )}
                  </View>
                ))}
              </>
            ) : (
              <>
                <Text style={styles.permSectionLabel}>USER MANAGEMENT</Text><Text style={styles.permSectionSubLabel}>Control which users this person can manage</Text>
                <TouchableOpacity style={[styles.manageCard, entityPermissions.userManagement?.canManage && styles.manageCardActive]} onPress={toggleUserManagementMain} activeOpacity={0.8}><Ionicons name={entityPermissions.userManagement?.canManage ? "checkmark" : "ellipse-outline"} size={22} color={entityPermissions.userManagement?.canManage ? '#4F46E5' : '#D1D5DB'} style={{ marginRight: 15 }}/><View><Text style={[styles.manageCardTitle, entityPermissions.userManagement?.canManage && {color: '#4F46E5'}]}>Staff Management Access</Text><Text style={styles.manageCardSub}>Allow this role to manage other staff members</Text></View></TouchableOpacity>
                {entityPermissions.userManagement?.canManage && (
                  <View style={{marginTop: 20}}>
                    <Text style={styles.boldSubTitle}>Accessible Staff Roles</Text>
                    <View style={styles.chipRow}>
                      {rolesList.filter(r => r.name !== 'admin').map((role) => {
                        const isSelected = entityPermissions.userManagement?.manageableRoles?.includes(role.name);
                        return (<TouchableOpacity key={role.id} style={[styles.permChip, isSelected && styles.permChipActive]} onPress={() => toggleManageableRole(role.name)}><Text style={[styles.permChipText, isSelected && styles.permChipTextActive]}>{role.name}</Text></TouchableOpacity>);
                      })}
                    </View>
                    <Text style={[styles.boldSubTitle, {marginTop: 25}]}>Editable User Fields</Text>
                    <View style={styles.chipRowGrid}>
                      {editableFieldsList.map((field) => {
                         const isSelected = entityPermissions.userManagement?.editableFields?.includes(field);
                         return (<TouchableOpacity key={field} style={[styles.permGridChip, isSelected && styles.permChipActive]} onPress={() => toggleEditableField(field)}><Text style={[styles.permChipText, isSelected && styles.permChipTextActive]}>{field}</Text></TouchableOpacity>)
                      })}
                    </View>
                  </View>
                )}
              </>
            )}
            <TouchableOpacity style={[styles.saveWhBtn, { marginBottom: 30, backgroundColor: '#4F46E5' }]} onPress={savePermissions}><Text style={styles.saveWhBtnText}>Save Role Permissions</Text></TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={showUsersModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
          <View style={styles.userListHeaderContainer}><TouchableOpacity onPress={() => setShowUsersModal(false)} style={{ marginBottom: 10 }}><Ionicons name="arrow-back" size={26} color="#111827" /></TouchableOpacity><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View><Text style={styles.permHeaderSubtitle}>GREENWAVE ADMIN</Text><Text style={styles.permHeaderTitle}>User Management</Text></View><TouchableOpacity style={styles.addUserBtnOutline} onPress={openAddUserForm}><Ionicons name="add" size={18} color="#6366F1" /><Text style={styles.addUserBtnText}>Add User</Text></TouchableOpacity></View></View>
          <View style={styles.searchBarContainer}><Ionicons name="search" size={20} color="#9CA3AF" /><TextInput style={styles.searchInput} placeholder="Search users..." placeholderTextColor="#9CA3AF" value={searchQuery} onChangeText={setSearchQuery} /></View>
          <ScrollView style={{ padding: 20 }}>
            {allUsersList.length === 0 ? <Text style={styles.emptyText}>No users found.</Text> : allUsersList.filter((u) => (u.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || ((u.email || '').toLowerCase().includes(searchQuery.toLowerCase()))).map((user) => (
                  <View key={user.id} style={styles.customUserCard}>
                    <View style={styles.customUserCardTop}><View style={[styles.customUserIconBox, { backgroundColor: '#EEF2FF' }]}><Ionicons name="person" size={24} color="#4F46E5" /></View><View style={styles.customUserInfo}><Text style={styles.customUserName}>{user.name}</Text><Text style={styles.customUserEmail}>{user.email}</Text></View><View style={[styles.customRoleBadge, { backgroundColor: '#EEF2FF' }]}><Text style={[styles.customRoleBadgeText, { color: '#4F46E5' }]}>{user.role ? user.role.toUpperCase() : 'UNKNOWN'}</Text></View></View>
                    <View style={styles.customUserMiddleRow}><View style={styles.customUserDetailItem}><Ionicons name="call-outline" size={14} color="#6B7280" style={{ marginRight: 6 }} /><Text style={styles.customUserDetailText}>{user.phone || 'N/A'}</Text></View><View style={styles.customUserDetailItem}><Ionicons name="location-outline" size={14} color="#6B7280" style={{ marginRight: 6 }} /><Text style={styles.customUserDetailText}>{user.location || 'Not Assigned'}</Text></View></View>
                    <View style={styles.drawerDivider} />
                    <View style={styles.customUserBottomRow}><TouchableOpacity onPress={() => openEditUserForm(user)} style={styles.customActionBtnEdit}><Ionicons name="pencil-outline" size={16} color="#6366F1" style={{ marginRight: 4 }} /><Text style={styles.customActionBtnTextEdit}>Edit</Text></TouchableOpacity><TouchableOpacity onPress={() => handleDeleteUser(user.id, user.name)} style={styles.customActionBtnDelete}><Ionicons name="trash-outline" size={16} color="#EF4444" style={{ marginRight: 4 }} /><Text style={styles.customActionBtnTextDelete}>Delete</Text></TouchableOpacity></View>
                  </View>
                ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={showAddUserModal} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.addWhBox}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 }}><Text style={styles.drawerTitle}>Create New User</Text><TouchableOpacity onPress={() => setShowAddUserModal(false)}><Ionicons name="close" size={26} color="#111827" /></TouchableOpacity></View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.inputLabel}>Full Name *</Text><TextInput style={[styles.textInput, addUserErrors.name && styles.inputErrorBorder]} placeholder="e.g. Rahul Sharma" value={newUser.name} onChangeText={(t) => { setNewUser({ ...newUser, name: t }); setAddUserErrors({ ...addUserErrors, name: null }); }} />{addUserErrors.name && <Text style={styles.errorText}>{addUserErrors.name}</Text>}
              <Text style={[styles.inputLabel, { marginTop: 15 }]}>Email Address *</Text><TextInput style={[styles.textInput, addUserErrors.email && styles.inputErrorBorder]} placeholder="e.g. rahul@gwgc.ca" autoCapitalize="none" keyboardType="email-address" value={newUser.email} onChangeText={(t) => { setNewUser({ ...newUser, email: t }); setAddUserErrors({ ...addUserErrors, email: null }); }} />{addUserErrors.email && <Text style={styles.errorText}>{addUserErrors.email}</Text>}
              <Text style={[styles.inputLabel, { marginTop: 15 }]}>Phone Number *</Text><TextInput style={[styles.textInput, addUserErrors.phone && styles.inputErrorBorder]} placeholder="e.g. +1 9876543210" keyboardType="phone-pad" value={newUser.phone} onChangeText={(t) => { setNewUser({ ...newUser, phone: t }); setAddUserErrors({ ...addUserErrors, phone: null }); }} />{addUserErrors.phone && <Text style={styles.errorText}>{addUserErrors.phone}</Text>}
              <Text style={[styles.inputLabel, { marginTop: 15 }]}>Password (Min 6 chars) *</Text><TextInput style={[styles.textInput, addUserErrors.password && styles.inputErrorBorder]} placeholder="Assign a password" secureTextEntry value={newUser.password} onChangeText={(t) => { setNewUser({ ...newUser, password: t }); setAddUserErrors({ ...addUserErrors, password: null }); }} />{addUserErrors.password && <Text style={styles.errorText}>{addUserErrors.password}</Text>}
              <Text style={[styles.inputLabel, { marginTop: 15 }]}>Role / Permission</Text><View style={styles.roleSelectionRow}>{rolesList.map((role) => (<TouchableOpacity key={role.id} style={[styles.roleChip, newUser.role === role.name && styles.roleChipActive]} onPress={() => setNewUser({ ...newUser, role: role.name })}><Text style={[styles.roleChipText, newUser.role === role.name && styles.roleChipTextActive]}>{role.name.toUpperCase()}</Text></TouchableOpacity>))}</View>
              <Text style={[styles.inputLabel, { marginTop: 15 }]}>Assigned Location</Text><TextInput style={styles.textInput} placeholder="e.g. Main Branch" value={newUser.location} onChangeText={(t) => setNewUser({ ...newUser, location: t })} />
              <TouchableOpacity style={styles.saveWhBtn} onPress={handleCreateNewUser}><Text style={styles.saveWhBtnText}>Create Account</Text></TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showEditUserModal} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.addWhBox}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}><Text style={styles.drawerTitle}>Edit User</Text><TouchableOpacity onPress={() => setShowEditUserModal(false)}><Ionicons name="close" size={26} color="#111827" /></TouchableOpacity></View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.inputLabel}>Full Name</Text><TextInput style={styles.textInput} value={editingUser.name} onChangeText={(t) => setEditingUser({ ...editingUser, name: t })} />
              <Text style={[styles.inputLabel, { marginTop: 15 }]}>Email Address</Text><TextInput style={styles.textInput} autoCapitalize="none" keyboardType="email-address" value={editingUser.email} onChangeText={(t) => setEditingUser({ ...editingUser, email: t })} />
              <Text style={[styles.inputLabel, { marginTop: 15 }]}>Phone Number</Text><TextInput style={styles.textInput} keyboardType="phone-pad" value={editingUser.phone} onChangeText={(t) => setEditingUser({ ...editingUser, phone: t })} />
              <Text style={[styles.inputLabel, { marginTop: 15 }]}>User Password (Min 6 chars)</Text><View style={[styles.textInput, { flexDirection: 'row', alignItems: 'center', padding: 0 }]}><TextInput style={{ flex: 1, padding: 12, color: '#111827', fontSize: 14 }} secureTextEntry={!showEditPassword} value={editingUser.password} onChangeText={(t) => setEditingUser({ ...editingUser, password: t })} /><TouchableOpacity onPress={() => setShowEditPassword(!showEditPassword)} style={{ padding: 12 }}><Ionicons name={showEditPassword ? 'eye-off' : 'eye'} size={20} color="#6B7280" /></TouchableOpacity></View>
              <Text style={[styles.inputLabel, { marginTop: 15 }]}>Assign Role</Text><View style={styles.roleSelectionRow}>{rolesList.map((role) => (<TouchableOpacity key={role.id} style={[styles.roleChip, editingUser.role === role.name && styles.roleChipActive]} onPress={() => setEditingUser({ ...editingUser, role: role.name })}><Text style={[styles.roleChipText, editingUser.role === role.name && styles.roleChipTextActive]}>{role.name.toUpperCase()}</Text></TouchableOpacity>))}</View>
              <Text style={[styles.inputLabel, { marginTop: 15 }]}>Assigned Location</Text><TextInput style={styles.textInput} value={editingUser.location} onChangeText={(t) => setEditingUser({ ...editingUser, location: t })} />
              <TouchableOpacity style={styles.saveWhBtn} onPress={saveUserEdit}><Text style={styles.saveWhBtnText}>Save Changes</Text></TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showAttendanceModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
          <View style={styles.modalHeader}><TouchableOpacity onPress={() => selectedWorkerHistory ? setSelectedWorkerHistory(null) : setShowAttendanceModal(false)}><Ionicons name={selectedWorkerHistory ? 'arrow-back' : 'close'} size={28} color="#111827" /></TouchableOpacity><Text style={styles.modalTitle}>{selectedWorkerHistory ? `${selectedWorkerHistory.name}'s History` : 'Staff Attendance'}</Text><View style={{ width: 28 }} /></View>
          <ScrollView style={{ padding: 20 }}>
            {!selectedWorkerHistory ? (allWorkers.length === 0 ? <Text style={styles.emptyText}>No workers found.</Text> : allWorkers.map((worker) => (<TouchableOpacity key={worker.id} style={styles.workerListCard} onPress={() => fetchWorkerHistory(worker)}><View style={{ flex: 1 }}><Text style={styles.workerListName}>{worker.name || 'Unknown User'}</Text><Text style={styles.workerListRole}>{worker.role ? worker.role.toUpperCase() : 'UNKNOWN'}</Text></View><Ionicons name="chevron-forward" size={20} color="#9CA3AF" /></TouchableOpacity>))) : historyData.length === 0 ? <Text style={styles.emptyText}>No work history recorded yet.</Text> : historyData.map((record, index) => (
                <View key={index} style={styles.historyRow}>
                  <View style={styles.historyDateBox}>
                    <Ionicons name="calendar-outline" size={18} color="#2E7D32" />
                    <Text style={styles.historyDate}>{record.date} {record.isOngoing && <Text style={{fontSize: 12, color: '#10B981', fontWeight: 'bold'}}>(Ongoing)</Text>}</Text>
                  </View>
                  <Text style={styles.historyTime}>{formatTime(record.totalMinutes)}</Text>
                </View>
              ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={showWarehouseModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
          <View style={styles.modalHeader}><TouchableOpacity onPress={() => setShowWarehouseModal(false)}><Ionicons name="close" size={28} color="#111827" /></TouchableOpacity><Text style={styles.modalTitle}>Warehouses</Text><TouchableOpacity onPress={openAddWarehouseForm}><Ionicons name="add-circle" size={30} color="#4F46E5" /></TouchableOpacity></View>
          <ScrollView style={{ padding: 20 }}>
            {warehouses.length === 0 ? <Text style={styles.emptyText}>No warehouses found.</Text> : warehouses.map((wh) => (
              <View key={wh.id} style={styles.warehouseCard}>
                <View style={styles.whHeaderRow}>
                  <Text style={styles.whTitle}>{wh.name}</Text>
                  <TouchableOpacity onPress={() => openEditWarehouseForm(wh)} style={styles.editBtnBox}><Ionicons name="pencil" size={16} color="#3B82F6" /></TouchableOpacity>
                </View>
                {wh.address ? <Text style={styles.whAddress}><Ionicons name="location-outline" size={14} /> {wh.address}</Text> : null}
                <View style={styles.drawerDivider} />
                {wh.materials && wh.materials.map((item, idx) => (<View key={idx} style={styles.matRow}><View style={[styles.matDot, { backgroundColor: '#4F46E5' }]} /><Text style={styles.matName}>{item.name}</Text><Text style={styles.matAmount}>{item.amount}</Text></View>))}
                <TouchableOpacity style={[styles.saveWhBtn, {marginTop: 15, paddingVertical: 12, backgroundColor: '#EEF2FF'}]} onPress={() => openWarehouseContainers(wh)}>
                  <Text style={{color: '#4F46E5', fontWeight: 'bold', fontSize: 14}}>View Containers History</Text>
                </TouchableOpacity>
              </View>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={showContainerHistoryModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowContainerHistoryModal(false)}><Ionicons name="arrow-back" size={28} color="#111827" /></TouchableOpacity>
            <View style={{flex:1, marginLeft: 15}}>
              <Text style={styles.modalTitle}>{selectedWarehouseForContainers?.name}</Text>
              <Text style={styles.chatHeaderSub}>Container Logs</Text>
            </View>
            <TouchableOpacity onPress={() => setShowAddContainerModal(true)} style={styles.addUserBtnOutline}><Ionicons name="add" size={18} color="#4F46E5"/><Text style={styles.addUserBtnText}>Receive Container</Text></TouchableOpacity>
          </View>
          <ScrollView style={{ padding: 20 }}>
            {warehouseContainers.length === 0 ? <Text style={styles.emptyText}>No containers logged yet.</Text> : warehouseContainers.map((container) => (
              <View key={container.id} style={styles.warehouseCard}>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10}}>
                  <Text style={{fontSize: 16, fontWeight: 'bold', color: '#111827'}}>Container: {container.number}</Text>
                  <Text style={{fontSize: 12, color: '#6B7280'}}>{container.receivedAt ? new Date(container.receivedAt.toDate()).toLocaleDateString() : ''}</Text>
                </View>
                <View style={styles.matRow}><Ionicons name="lock-closed-outline" size={14} color="#6B7280" style={{marginRight: 5}}/><Text style={styles.matName}>Seal Number:</Text><Text style={styles.matAmount}>{container.seal}</Text></View>
                <View style={styles.matRow}><Ionicons name="navigate-outline" size={14} color="#6B7280" style={{marginRight: 5}}/><Text style={styles.matName}>Origin:</Text><Text style={styles.matAmount}>{container.origin}</Text></View>
                {container.notes ? <Text style={{fontSize: 13, color: '#4B5563', marginTop: 10, fontStyle: 'italic'}}>&quot;{container.notes}&quot;</Text> : null}
                <Text style={{fontSize: 11, color: '#9CA3AF', marginTop: 15}}>Received By: {container.receivedBy}</Text>
                
                {container.images && container.images.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 15 }}>
                    {container.images.map((uri, idx) => (
                      <Image key={idx} source={{ uri }} style={{ width: 60, height: 60, borderRadius: 8, marginRight: 10, borderWidth: 1, borderColor: '#E5E7EB' }} />
                    ))}
                  </ScrollView>
                )}
              </View>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={showAddContainerModal} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F3F4F6' }}>
          <View style={[styles.modalHeader, {backgroundColor: '#FFF'}]}>
            <TouchableOpacity onPress={() => setShowAddContainerModal(false)} disabled={isUploading}><Ionicons name="close" size={28} color="#111827" /></TouchableOpacity>
            <Text style={styles.modalTitle}>Receive Container</Text>
            <View style={{width:28}}/>
          </View>
          
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{padding: 15}}>
            <View style={styles.formSection}>
              <Text style={styles.formSectionTitle}>Container Details</Text>
              <Text style={styles.inputLabel}>Container Number *</Text>
              <TextInput style={styles.textInput} placeholder="e.g. MSKU1234567" value={newContainer.number} onChangeText={(t) => setNewContainer({...newContainer, number: t})} editable={!isUploading} />
              <Text style={[styles.inputLabel, {marginTop: 15}]}>Seal Number *</Text>
              <TextInput style={styles.textInput} placeholder="e.g. SL98765" value={newContainer.seal} onChangeText={(t) => setNewContainer({...newContainer, seal: t})} editable={!isUploading} />
              <Text style={[styles.inputLabel, {marginTop: 15}]}>Origin (Came From) *</Text>
              <TextInput style={styles.textInput} placeholder="e.g. Mumbai Port" value={newContainer.origin} onChangeText={(t) => setNewContainer({...newContainer, origin: t})} editable={!isUploading} />
              <Text style={[styles.inputLabel, {marginTop: 15}]}>Additional Notes</Text>
              <TextInput style={[styles.textInput, {height: 80, textAlignVertical: 'top'}]} placeholder="Condition, remarks..." multiline={true} value={newContainer.notes} onChangeText={(t) => setNewContainer({...newContainer, notes: t})} editable={!isUploading} />
            </View>

            <View style={styles.formSection}>
              <Text style={styles.formSectionTitle}>Photos (Seal / Container)</Text>
              <TouchableOpacity style={styles.imageUploadBox} onPress={pickContainerImages} disabled={isUploading}>
                <Ionicons name="images-outline" size={32} color="#4F46E5" />
                <Text style={styles.uploadBoxText}>Gallery</Text>
                <Text style={styles.uploadBoxSub}>Select multiple</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.addUserBtnOutline, {borderColor: '#FDE68A', backgroundColor: '#FFFBEB', alignSelf: 'center', marginTop: 15}]} onPress={pickContainerCamera} disabled={isUploading}><Ionicons name="camera-outline" size={20} color="#D97706" style={{ marginRight: 8 }}/><Text style={{color: '#D97706', fontWeight: 'bold'}}>Take Photo</Text></TouchableOpacity>

              {containerImages.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 15 }}>
                  {containerImages.map((uri, idx) => (
                    <View key={idx} style={{ marginRight: 10, position: 'relative' }}>
                      <Image source={{ uri }} style={{ width: 80, height: 80, borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB' }} />
                      {!isUploading && (
                        <TouchableOpacity style={{ position: 'absolute', top: -5, right: -5, backgroundColor: '#EF4444', borderRadius: 12, padding: 2 }} onPress={() => setContainerImages(prev => prev.filter((_, i) => i !== idx))}>
                          <Ionicons name="close" size={16} color="#FFF" />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>

            <TouchableOpacity style={[styles.saveWhBtn, isUploading && {opacity: 0.7}]} onPress={handleSaveContainer} disabled={isUploading}>
              {isUploading ? (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <ActivityIndicator color="#FFF" style={{ marginRight: 10 }} />
                  <Text style={styles.saveWhBtnText}>{uploadError ? 'Upload Failed' : 'Saving Data...'}</Text>
                </View>
              ) : (
                <Text style={styles.saveWhBtnText}>Save Container Log</Text>
              )}
            </TouchableOpacity>
            <View style={{height: 40}}/>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={showAddWarehouseModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.addWhBox}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}><Text style={styles.drawerTitle}>{editingWarehouseId ? 'Edit Warehouse' : 'New Warehouse'}</Text><TouchableOpacity onPress={() => setShowAddWarehouseModal(false)}><Ionicons name="close" size={26} color="#111827" /></TouchableOpacity></View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.inputLabel}>Warehouse Name</Text><TextInput style={styles.textInput} placeholder="e.g. Main Hub" value={whName} onChangeText={setWhName} />
              <Text style={[styles.inputLabel, { marginTop: 15 }]}>Address</Text><TextInput style={styles.textInput} placeholder="e.g. 123 Industrial Area" value={whAddress} onChangeText={setWhAddress} />
              <Text style={[styles.inputLabel, { marginTop: 15 }]}>Materials Inside</Text>
              {whMaterials.map((mat, index) => (<View key={index} style={styles.dynamicRow}><TextInput style={[styles.textInput, { flex: 2, marginRight: 10 }]} placeholder="Name" value={mat.name} onChangeText={(text) => handleMaterialChange(text, index, 'name')} /><TextInput style={[styles.textInput, { flex: 1, marginRight: 10 }]} placeholder="Amount" value={mat.amount} onChangeText={(text) => handleMaterialChange(text, index, 'amount')} />{whMaterials.length > 1 && <TouchableOpacity onPress={() => removeMaterialRow(index)} style={styles.removeRowBtn}><Ionicons name="trash" size={20} color="#EF4444" /></TouchableOpacity>}</View>))}
              <TouchableOpacity style={styles.addMoreBtn} onPress={handleAddMaterialRow}><Ionicons name="add" size={18} color="#4F46E5" /><Text style={styles.addMoreText}>Add Material</Text></TouchableOpacity>
              <TouchableOpacity style={styles.saveWhBtn} onPress={saveWarehouse}><Text style={styles.saveWhBtnText}>{editingWarehouseId ? 'Update' : 'Save'}</Text></TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showProductsModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
          <View style={styles.userListHeaderContainer}>
            <TouchableOpacity onPress={() => setShowProductsModal(false)} style={{ marginBottom: 10 }}><Ionicons name="arrow-back" size={26} color="#111827" /></TouchableOpacity>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View><Text style={styles.permHeaderSubtitle}>GREENWAVE ADMIN</Text><Text style={styles.permHeaderTitle}>Product Catalog</Text></View><TouchableOpacity style={[styles.addUserBtnOutline, {backgroundColor: '#EEF2FF'}]} onPress={() => { setShowAddProductModal(true); setProductImages([]); }}><Ionicons name="add" size={18} color="#4F46E5" /><Text style={[styles.addUserBtnText, {color: '#4F46E5'}]}>Add Product</Text></TouchableOpacity></View>
          </View>
          <View style={styles.searchBarContainer}><Ionicons name="search" size={20} color="#9CA3AF" /><TextInput style={styles.searchInput} placeholder="Search products by name..." placeholderTextColor="#9CA3AF" value={productSearchQuery} onChangeText={setProductSearchQuery} /></View>
          <ScrollView style={{ padding: 20 }} showsVerticalScrollIndicator={false}>
            {productsList.filter(p => (p.name || '').toLowerCase().includes(productSearchQuery.toLowerCase())).map((item) => (
                <View key={item.id} style={styles.productCard}>
                  <View style={styles.productCardTop}>
                    <View style={styles.productImagePlaceholder}>
                      {item.images && item.images.length > 0 ? (<Image source={{ uri: item.images[0] }} style={{ width: 80, height: 80, borderRadius: 8 }} />) : (<Ionicons name="image-outline" size={28} color="#9CA3AF" />)}
                    </View>
                    <View style={styles.productInfo}><Text style={styles.productName} numberOfLines={2}>{item.name}</Text><Text style={styles.productCategory}>{item.category || 'Uncategorized'}</Text><Text style={styles.productPrice}>{item.price}</Text></View>
                  </View>
                  <View style={styles.drawerDivider} />
                  <View style={styles.productCardBottom}>
                    <Text style={[styles.stockText, item.stock > 0 ? styles.inStock : styles.outOfStock]}>{item.stock > 0 ? `In Stock (${item.stock})` : 'Out of Stock'}</Text>
                    <View style={{ flexDirection: 'row' }}><TouchableOpacity style={[styles.editBtnBox, {borderColor: '#FECACA', backgroundColor: '#FEF2F2'}]} onPress={() => deleteProduct(item.id)}><Ionicons name="trash" size={16} color="#EF4444" /></TouchableOpacity></View>
                  </View>
                </View>
              ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={showAddProductModal} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F3F4F6' }}>
          <View style={[styles.modalHeader, {backgroundColor: '#FFF'}]}><TouchableOpacity onPress={() => setShowAddProductModal(false)} disabled={isUploading}><Ionicons name="close" size={28} color="#111827" /></TouchableOpacity><Text style={styles.modalTitle}>List New Product</Text><View style={{width:28}}/></View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{padding: 15}}>
            <View style={styles.formSection}>
              <Text style={styles.formSectionTitle}>Product Images</Text>
              <TouchableOpacity style={styles.imageUploadBox} onPress={pickProductImages} disabled={isUploading}><Ionicons name="cloud-upload-outline" size={32} color="#4F46E5" /><Text style={styles.uploadBoxText}>Tap to add product photos</Text><Text style={styles.uploadBoxSub}>Max 10 images allowed ({productImages.length}/10)</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.addUserBtnOutline, {borderColor: '#FDE68A', backgroundColor: '#FFFBEB', alignSelf: 'center', marginTop: 15}]} onPress={pickProductPhotoViaCamera} disabled={isUploading}><Ionicons name="camera-outline" size={20} color="#D97706" style={{ marginRight: 8 }}/><Text style={{color: '#D97706', fontWeight: 'bold'}}>Add with Camera</Text></TouchableOpacity>
              {productImages.length > 0 && (<ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 15 }}>{productImages.map((uri, idx) => (<View key={idx} style={{ marginRight: 10, position: 'relative' }}><Image source={{ uri }} style={{ width: 80, height: 80, borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB' }} />{!isUploading && (<TouchableOpacity style={{ position: 'absolute', top: -5, right: -5, backgroundColor: '#EF4444', borderRadius: 12, padding: 2 }} onPress={() => removeProductImage(idx)}><Ionicons name="close" size={16} color="#FFF" /></TouchableOpacity>)}</View>))}</ScrollView>)}
            </View>
            <View style={styles.formSection}><Text style={styles.formSectionTitle}>Basic Details</Text><Text style={styles.inputLabel}>Product Title *</Text><TextInput style={styles.textInput} placeholder="e.g. Recycled Paper Bundle" value={newProduct.name} onChangeText={(t) => setNewProduct({...newProduct, name: t})} editable={!isUploading} /><Text style={[styles.inputLabel, {marginTop: 15}]}>Category *</Text><TextInput style={styles.textInput} placeholder="e.g. Raw Material" value={newProduct.category} onChangeText={(t) => setNewProduct({...newProduct, category: t})} editable={!isUploading} /><Text style={[styles.inputLabel, {marginTop: 15}]}>Description *</Text><TextInput style={[styles.textInput, {height: 80, textAlignVertical: 'top'}]} placeholder="Detailed product description..." multiline={true} value={newProduct.description} onChangeText={(t) => setNewProduct({...newProduct, description: t})} editable={!isUploading} /></View>
            <View style={styles.formSection}><Text style={styles.formSectionTitle}>Pricing & Inventory</Text><View style={{flexDirection: 'row', justifyContent: 'space-between'}}><View style={{flex: 1, marginRight: 10}}><Text style={styles.inputLabel}>Price *</Text><TextInput style={styles.textInput} placeholder="0.00" keyboardType="numeric" value={newProduct.price} onChangeText={(t) => setNewProduct({...newProduct, price: t})} editable={!isUploading} /></View><View style={{flex: 1}}><Text style={styles.inputLabel}>Stock Quantity *</Text><TextInput style={styles.textInput} placeholder="0" keyboardType="numeric" value={newProduct.stock} onChangeText={(t) => setNewProduct({...newProduct, stock: t})} editable={!isUploading} /></View></View></View>
            <TouchableOpacity style={[styles.saveWhBtn, isUploading && {opacity: 0.7}]} onPress={handleAddProduct} disabled={isUploading}>{isUploading ? (<View style={{ flexDirection: 'row', alignItems: 'center' }}><ActivityIndicator color="#FFF" style={{ marginRight: 10 }} /><Text style={styles.saveWhBtnText}>{uploadError ? 'Upload Failed' : 'Uploading...'}</Text></View>) : (<Text style={styles.saveWhBtnText}>Publish Product</Text>)}</TouchableOpacity>
            {uploadError ? <Text style={{color: 'red', textAlign:'center', marginTop:10}}>{uploadError}</Text> : null}
            <View style={{height: 40}}/>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={showChatListModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
          <View style={styles.userListHeaderContainer}>
            <TouchableOpacity onPress={() => setShowChatListModal(false)} style={{ marginBottom: 10 }}><Ionicons name="arrow-back" size={26} color="#111827" /></TouchableOpacity>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View><Text style={styles.permHeaderSubtitle}>COMMUNICATION</Text><Text style={styles.permHeaderTitle}>Branch Chats</Text></View><TouchableOpacity style={[styles.addUserBtnOutline, {backgroundColor: '#EEF2FF'}]} onPress={() => setShowCreateChatModal(true)}><Ionicons name="add" size={18} color="#4F46E5" /><Text style={[styles.addUserBtnText, {color: '#4F46E5'}]}>New Chat</Text></TouchableOpacity></View>
          </View>
          <ScrollView style={{ padding: 20 }} showsVerticalScrollIndicator={false}>
            {chatsList.length === 0 ? (<Text style={styles.emptyText}>No chat rooms created yet.</Text>) : (chatsList.map((chat) => (<TouchableOpacity key={chat.id} style={styles.chatRoomCard} onPress={() => { setActiveChatRoom(chat); setShowChatListModal(false); }}><View style={styles.chatRoomIcon}><Ionicons name="chatbubbles" size={24} color="#4F46E5" /></View><View style={{ flex: 1 }}><Text style={styles.chatRoomName}>{chat.name}</Text><Text style={styles.chatRoomSub}>{chat.participantIds?.length || 0} Participants</Text></View><Ionicons name="chevron-forward" size={20} color="#9CA3AF" /></TouchableOpacity>)))}
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={showCreateChatModal} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.addWhBox, { maxHeight: '90%', padding: 0 }]}><View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}><Text style={styles.drawerTitle}>Create Chat Room</Text><TouchableOpacity onPress={() => setShowCreateChatModal(false)}><Ionicons name="close" size={26} color="#111827" /></TouchableOpacity></View><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20 }}><Text style={styles.inputLabel}>Branch / Chat Name *</Text><TextInput style={styles.textInput} placeholder="e.g. Noida Warehouse Team" value={newChatDetails.name} onChangeText={(t) => setNewChatDetails({...newChatDetails, name: t})} /><Text style={[styles.inputLabel, {marginTop: 20, marginBottom: 10}]}>Invite Workers</Text>{allUsersList.filter(u => u.id !== auth.currentUser?.uid).map(user => { const isSelected = newChatDetails.participants.includes(user.id); return (<TouchableOpacity key={user.id} style={[styles.inviteCard, isSelected && styles.inviteCardActive]} onPress={() => toggleCreateChatParticipant(user.id)} activeOpacity={0.7}><View style={{flexDirection: 'row', alignItems: 'center'}}><View style={[styles.inviteCheckbox, isSelected && styles.inviteCheckboxActive]}>{isSelected && <Ionicons name="checkmark" size={14} color="#FFF" />}</View><View><Text style={styles.inviteName}>{user.name}</Text><Text style={styles.inviteRole}>{user.role.toUpperCase()} • {user.location || 'N/A'}</Text></View></View></TouchableOpacity>) })}<TouchableOpacity style={styles.saveWhBtn} onPress={handleCreateChatRoomSimple}><Text style={styles.saveWhBtnText}>Create Room & Invite</Text></TouchableOpacity></ScrollView></View>
        </View>
      </Modal>

      <Modal visible={!!activeChatRoom} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F3F4F6' }}>
          {showCameraPreviewOverlay && (<View style={[StyleSheet.absoluteFill, {backgroundColor: '#000', zIndex: 100}]}><View style={[styles.modalHeader, {backgroundColor: '#000', borderBottomWidth: 0}]}><TouchableOpacity onPress={() => { setCameraPreviewUri(null); setShowCameraPreviewOverlay(false); }}><Ionicons name="close" size={28} color="#FFF" /></TouchableOpacity><Text style={[styles.modalTitle, {color: '#FFF'}]}>Preview Photo</Text><View style={{width: 28}} /></View>{cameraPreviewUri && <Image source={{ uri: cameraPreviewUri }} style={{flex: 1, marginVertical: 20}} resizeMode="contain"/>}<View style={{flexDirection: 'row', justifyContent: 'center', paddingBottom: 30}}><TouchableOpacity style={[styles.startBtn, {paddingVertical: 15, width: 60, height: 60, borderRadius: 30}]} onPress={() => { setCameraPreviewUri(null); setShowCameraPreviewOverlay(false); }}><Ionicons name="close" size={30} color="#EF4444" /></TouchableOpacity><TouchableOpacity style={[styles.completeBtn, {paddingVertical: 15, width: 60, height: 60, borderRadius: 30, marginLeft: 20}]} onPress={confirmAndSendCapturedPhoto} disabled={isUploading}>{isUploading ? <ActivityIndicator color="#FFF"/> : <Ionicons name="checkmark" size={30} color="#10B981" />}</TouchableOpacity></View></View>)}
          {showContactPickerOverlay && (<View style={[StyleSheet.absoluteFill, {backgroundColor: '#FFF', zIndex: 100}]}><View style={styles.modalHeader}><TouchableOpacity onPress={() => setShowContactPickerOverlay(false)}><Ionicons name="close" size={28} color="#111827" /></TouchableOpacity><Text style={styles.modalTitle}>Select Contact</Text><View style={{width: 28}} /></View><FlatList data={allPhoneContacts} renderItem={({item}) => (<TouchableOpacity key={item.id} style={styles.workerListCard} onPress={() => selectAndSendContact(item)}><View style={{ flex: 1 }}><Text style={styles.workerListName}>{item.name}</Text><Text style={styles.workerListRole}>{item.phoneNumbers?.[0]?.number || 'No number'}</Text></View><Ionicons name="share-outline" size={20} color="#4F46E5" /></TouchableOpacity>)} keyExtractor={(item) => item.id} contentContainerStyle={{ padding: 20 }} /></View>)}
          {showRenameOverlay && (<View style={[StyleSheet.absoluteFill, styles.modalOverlay, {zIndex: 100}]}><View style={[styles.addWhBox, {maxHeight: 250}]}><Text style={styles.inputLabel}>Rename Chat Room</Text><TextInput style={styles.textInput} placeholder={activeChatRoom?.name} value={newChatNameInput} onChangeText={setNewChatNameInput} /><View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 20}}><TouchableOpacity style={[styles.addUserBtnOutline, {borderColor: '#E5E7EB', backgroundColor: '#F9FAFB'}]} onPress={() => setShowRenameOverlay(false)}><Text style={{color: '#6B7280'}}>Cancel</Text></TouchableOpacity><TouchableOpacity style={styles.saveWhBtn} onPress={handleRenameChat}><Text style={styles.saveWhBtnText}>Rename</Text></TouchableOpacity></View></View></View>)}
          {showEditParticipantsOverlay && (<View style={[StyleSheet.absoluteFill, {backgroundColor: '#FFF', zIndex: 100}]}><View style={[styles.modalHeader, {borderBottomWidth: 1, borderBottomColor: '#F3F4F6'}]}><TouchableOpacity onPress={() => setShowEditParticipantsOverlay(false)}><Ionicons name="close" size={28} color="#111827" /></TouchableOpacity><Text style={styles.modalTitle}>Edit Members</Text><TouchableOpacity onPress={saveParticipantEdits} style={styles.saveRoleEditBtn}><Text style={styles.saveRoleEditBtnText}>Save</Text></TouchableOpacity></View><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20 }}>{allUsersList.filter(u => u.id !== auth.currentUser?.uid).map(user => { const isSelected = editChatParticipants.includes(user.id); return (<TouchableOpacity key={user.id} style={[styles.inviteCard, isSelected && styles.inviteCardActive]} onPress={() => toggleEditParticipant(user.id)} activeOpacity={0.7}><View style={{flexDirection: 'row', alignItems: 'center'}}><View style={[styles.inviteCheckbox, isSelected && styles.inviteCheckboxActive]}>{isSelected && <Ionicons name="checkmark" size={14} color="#FFF" />}</View><View><Text style={styles.inviteName}>{user.name}</Text><Text style={styles.inviteRole}>{user.role.toUpperCase()} • {user.location || 'N/A'}</Text></View></View></TouchableOpacity>); })}</ScrollView></View>)}
          
          <View style={styles.chatHeader}><TouchableOpacity onPress={() => {setActiveChatRoom(null); setShowChatListModal(true);}} style={{ padding: 5 }}><Ionicons name="arrow-back" size={26} color="#111827" /></TouchableOpacity><View style={{ flex: 1, marginLeft: 15 }}><Text style={styles.chatHeaderTitle}>{activeChatRoom?.name}</Text><Text style={styles.chatHeaderSub}>{activeChatRoom?.participantIds?.length || 0} Members</Text></View><TouchableOpacity onPress={() => openParticipantEdit(activeChatRoom)} style={{ marginRight: 15 }}><Ionicons name="person-add-outline" size={22} color="#111827" /></TouchableOpacity><TouchableOpacity onPress={() => setShowSettingsMenu(!showSettingsMenu)}><Ionicons name="ellipsis-vertical" size={22} color="#111827" /></TouchableOpacity></View>
          {showSettingsMenu && (<TouchableOpacity style={styles.settingsMenuOverlay} activeOpacity={1} onPress={() => setShowSettingsMenu(false)}><View style={styles.settingsMenuBox}><TouchableOpacity style={styles.attachOptionRow} onPress={() => { setShowSettingsMenu(false); setShowRenameOverlay(true); setNewChatNameInput(activeChatRoom?.name || ''); }}><Ionicons name="pencil" size={16} color="#6B7280" style={{marginRight: 10}}/><Text style={styles.attachTextRow}>Edit Chat Name</Text></TouchableOpacity><TouchableOpacity style={[styles.attachOptionRow, {borderTopWidth: 1, borderTopColor: '#F3F4F6'}]} onPress={() => { setShowSettingsMenu(false); Alert.alert('Coming Soon', 'Search in Chat feature coming soon!')}}><Ionicons name="search" size={16} color="#6B7280" style={{marginRight: 10}}/><Text style={styles.attachTextRow}>Search Messages</Text></TouchableOpacity></View></TouchableOpacity>)}
          
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {isUploading && (<View style={styles.chatLoaderOverlay}>{uploadError ? <Text style={[styles.chatLoaderText, {color:'red'}]}>{uploadError}</Text> : <><ActivityIndicator size="large" color="#4F46E5" /><Text style={styles.chatLoaderText}>Uploading Media...</Text></>}</View>)}
            <FlatList data={messagesList} renderItem={({item}) => <ChatMessageBubble message={item} isMe={item.senderId === (currentUserProfile?.id || auth.currentUser?.uid)} />} keyExtractor={(item) => item.id} contentContainerStyle={{ padding: 15, paddingBottom: 30 }} ref={messageListRef} onContentSizeChange={() => {if(messagesList.length > 0) messageListRef.current?.scrollToEnd({animated: true})}} ListEmptyComponent={<Text style={styles.emptyText}>No messages yet. Say hi!</Text>} showsVerticalScrollIndicator={false} />
            {showAttachMenu && (<View style={styles.attachMenuOverlay}><TouchableOpacity style={styles.attachOption} onPress={pickGalleryMultimedia}><View style={[styles.attachIcon, {backgroundColor: '#A7F3D0'}]}><Ionicons name="images" size={20} color="#047857"/></View><Text style={styles.attachText}>Gallery</Text></TouchableOpacity><TouchableOpacity style={styles.attachOption} onPress={pickCameraPhoto}><View style={[styles.attachIcon, {backgroundColor: '#FED7AA'}]}><Ionicons name="camera" size={20} color="#C2410C"/></View><Text style={styles.attachText}>Camera</Text></TouchableOpacity><TouchableOpacity style={styles.attachOption} onPress={pickDocumentFile}><View style={[styles.attachIcon, {backgroundColor: '#C7D2FE'}]}><Ionicons name="document-text" size={20} color="#4338CA"/></View><Text style={styles.attachText}>Document</Text></TouchableOpacity><TouchableOpacity style={styles.attachOption} onPress={pickContact}><View style={[styles.attachIcon, {backgroundColor: '#E9D5FF'}]}><Ionicons name="person" size={20} color="#7E22CE"/></View><Text style={styles.attachText}>Contact</Text></TouchableOpacity></View>)}
            {isRecording && <TouchableOpacity style={styles.recordStatusBar} onPress={cancelRecordingAudio}><Ionicons name="trash-outline" size={16} color="#FFF"/><Text style={styles.recordStatusText}> Slide or Tap to Cancel</Text></TouchableOpacity>}
            <View style={styles.chatInputContainer}><TouchableOpacity style={styles.chatAttachBtn} onPress={() => setShowAttachMenu(!showAttachMenu)}><Ionicons name={showAttachMenu ? 'close' : 'attach'} size={24} color="#6B7280" /></TouchableOpacity><TextInput style={[styles.chatInputBar, isRecording && {color: '#EF4444'}]} placeholder={isRecording ? 'Recording voice note...' : "Type your message..."} value={messageInput} onChangeText={setMessageInput} multiline pointerEvents="auto" />{messageInput.trim().length > 0 ? (<TouchableOpacity style={[styles.chatSendBtn, {backgroundColor: '#6366F1'}]} onPress={handleSendMessageText}><Ionicons name="send" size={18} color="#FFF" style={{ marginLeft: 3 }} /></TouchableOpacity>) : (<TouchableOpacity style={[styles.chatMicBtn, isRecording && styles.chatMicBtnRecording]} onPress={() => Platform.OS === 'web' ? Alert.alert('Not Supported', 'Voice notes only work on the Mobile App.') : null} onLongPress={() => Platform.OS !== 'web' ? startRecordingAudio() : null} onPressOut={() => Platform.OS !== 'web' ? stopAndSendRecording() : null} activeOpacity={0.8}><Ionicons name={isRecording ? "radio-button-on" : "mic"} size={22} color="#FFF" /></TouchableOpacity>)}</View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* DASHBOARD MENU */}
      <Modal visible={isMenuOpen} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.sideDrawer}>
            <View style={styles.drawerHeader}><Text style={styles.drawerTitle}>Menu</Text><TouchableOpacity onPress={() => setIsMenuOpen(false)}><Ionicons name="close" size={28} color="#111827" /></TouchableOpacity></View>
            <TouchableOpacity style={styles.drawerMenuBtn} onPress={() => setIsMenuOpen(false)}><Ionicons name="grid-outline" size={22} color="#4F46E5" /><Text style={styles.drawerMenuText}>Dashboard</Text></TouchableOpacity>
            <TouchableOpacity style={styles.drawerMenuBtn} onPress={() => { setIsMenuOpen(false); setShowOrdersModal(true); }}><Ionicons name="clipboard-outline" size={22} color="#4F46E5" /><Text style={styles.drawerMenuText}>Manage Orders</Text></TouchableOpacity>
            <TouchableOpacity style={styles.drawerMenuBtn} onPress={openAttendance}><Ionicons name="calendar-outline" size={22} color="#4F46E5" /><Text style={styles.drawerMenuText}>Attendance History</Text></TouchableOpacity>
            <TouchableOpacity style={styles.drawerMenuBtn} onPress={openUsersManagement}><Ionicons name="people-outline" size={22} color="#4F46E5" /><Text style={styles.drawerMenuText}>Manage Users</Text></TouchableOpacity>
            <TouchableOpacity style={styles.drawerMenuBtn} onPress={() => { setIsMenuOpen(false); setShowRolesModal(true); }}><Ionicons name="briefcase-outline" size={22} color="#4F46E5" /><Text style={styles.drawerMenuText}>Job Roles</Text></TouchableOpacity>
            <TouchableOpacity style={styles.drawerMenuBtn} onPress={() => { setIsMenuOpen(false); setShowWarehouseModal(true); }}><Ionicons name="cube-outline" size={22} color="#4F46E5" /><Text style={styles.drawerMenuText}>Warehouses</Text></TouchableOpacity>
            <TouchableOpacity style={styles.drawerMenuBtn} onPress={() => { setIsMenuOpen(false); setShowProductsModal(true); }}><Ionicons name="pricetags-outline" size={22} color="#4F46E5" /><Text style={styles.drawerMenuText}>Products</Text></TouchableOpacity>
            <TouchableOpacity style={styles.drawerMenuBtn} onPress={() => { setIsMenuOpen(false); setShowChatListModal(true); }}><Ionicons name="chatbubbles-outline" size={22} color="#4F46E5" /><Text style={styles.drawerMenuText}>Branch Chats</Text></TouchableOpacity>
            
            {/* 🔥 NEW LOGS & ALERTS MENU ITEMS 🔥 */}
            <TouchableOpacity style={styles.drawerMenuBtn} onPress={() => { setIsMenuOpen(false); setShowAlertsModal(true); }}><Ionicons name="notifications-outline" size={22} color="#4F46E5" /><Text style={styles.drawerMenuText}>Send Alert</Text></TouchableOpacity>
            <TouchableOpacity style={styles.drawerMenuBtn} onPress={() => { setIsMenuOpen(false); setShowLogsModal(true); }}><Ionicons name="shield-checkmark-outline" size={22} color="#4F46E5" /><Text style={styles.drawerMenuText}>Activity Logs</Text></TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.closeOverlayArea} onPress={() => setIsMenuOpen(false)} />
        </View>
      </Modal>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.mainContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setIsMenuOpen(true)} style={styles.menuIcon}><Ionicons name="menu-outline" size={32} color="#1B5E20" /></TouchableOpacity>
          <View style={{ flex: 1 }}><Text style={styles.brandSubtitle}>GREENWAVE ADMIN</Text><Text style={styles.headerTitle}>Dashboard</Text></View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}><Ionicons name="log-out-outline" size={26} color="#2E7D32" /></TouchableOpacity>
        </View>

        <View style={styles.sectionHeaderRow}><Text style={styles.sectionLabel}>ACTIVE SESSIONS</Text><View style={styles.onlineBadge}><Text style={styles.onlineText}>{activeUsers.length} Online</Text></View></View>
        <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}><ScrollView nestedScrollEnabled={true} showsVerticalScrollIndicator={true} style={{ maxHeight: 210 }} contentContainerStyle={{ padding: 15 }}>{activeUsers.map((user) => (<View key={user.id} style={styles.userRow}><View style={styles.dot} /><View style={{ flex: 1 }}><Text style={styles.userName}>{user.name} - {user.role}</Text><LiveTimeCounter lastLogin={user.lastLogin} /></View><Ionicons name="pulse-outline" size={18} color="#2E7D32" /></View>))}{activeUsers.length === 0 && <Text style={styles.emptyText}>No one is active</Text>}</ScrollView></View>

        <Text style={styles.sectionLabel}>BUSINESS OVERVIEW</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.ovRow} onPress={() => handleOverviewClick('Active')} activeOpacity={0.8}><Ionicons name="clipboard-outline" size={20} color="#4F46E5" /><Text style={styles.ovText}>Active Orders: {stats.active}</Text></TouchableOpacity><View style={styles.separator} />
          <TouchableOpacity style={styles.ovRow} onPress={() => handleOverviewClick('Pending')} activeOpacity={0.8}><Ionicons name="time-outline" size={20} color="#F59E0B" /><Text style={styles.ovText}>Pending: {stats.pending}</Text></TouchableOpacity><View style={styles.separator} />
          <TouchableOpacity style={styles.ovRow} onPress={() => handleOverviewClick('Completed')} activeOpacity={0.8}><Ionicons name="checkmark-done-outline" size={20} color="#10B981" /><Text style={styles.ovText}>Completed: {stats.completed}</Text></TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>QUICK ACTIONS</Text>
        
        {/* 🔥 NEW 3x3 GRID WITH PREMIUM ICONS 🔥 */}
        <View style={styles.grid}>
          {quickActionsList.map((item, i) => (
            <TouchableOpacity 
              key={i} 
              style={[
                styles.gridItem, 
                { marginRight: (i + 1) % 3 === 0 ? 0 : '3.5%' } 
              ]} 
              onPress={() => { 
                if (item.name === 'Orders') { setActiveOrderTab('Active'); setShowOrdersModal(true); } 
                if (item.name === 'Attendance') openAttendance(); 
                if (item.name === 'Users') openUsersManagement(); 
                if (item.name === 'Job Roles') setShowRolesModal(true); 
                if (item.name === 'Warehouses') setShowWarehouseModal(true); 
                if (item.name === 'Products') setShowProductsModal(true); 
                if (item.name === 'Chats') setShowChatListModal(true); 
                if (item.name === 'Activity Logs') setShowLogsModal(true);
                if (item.name === 'Send Alert') setShowAlertsModal(true);
              }}
            >
              <View style={[styles.gridIconBox, { backgroundColor: item.bg }]}>
                <Ionicons name={item.icon} size={22} color={item.color} />
              </View>
              <Text style={styles.gridText}>{item.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F9FAFB' },
  mainContent: { padding: 20, flexGrow: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25 },
  menuIcon: { marginRight: 15, position: 'relative' },
  brandSubtitle: { fontSize: 11, fontWeight: 'bold', color: '#9CA3AF', letterSpacing: 1 },
  headerTitle: { fontSize: 30, fontWeight: 'bold', color: '#111827' },
  logoutBtn: { width: 48, height: 48, backgroundColor: '#FFF', borderRadius: 12, justifyContent: 'center', alignItems: 'center', elevation: 2, borderWidth: 1, borderColor: '#F3F4F6' },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 },
  sectionLabel: { fontSize: 12, fontWeight: 'bold', color: '#9CA3AF', marginBottom: 10, letterSpacing: 0.5 },
  onlineBadge: { backgroundColor: '#ECFDF5', paddingHorizontal: 10, borderRadius: 20, justifyContent: 'center' },
  onlineText: { fontSize: 10, fontWeight: 'bold', color: '#10B981' },
  card: { backgroundColor: '#FFF', borderRadius: 16, marginBottom: 25, elevation: 2, borderWidth: 1, borderColor: '#F3F4F6' },
  userRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981', marginRight: 10 },
  userName: { fontWeight: 'bold', fontSize: 14, color: '#111827' },
  userTime: { fontSize: 11, color: '#10B981', marginTop: 2, fontWeight: '600' },
  ovRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  ovText: { marginLeft: 10, fontWeight: '500', color: '#111827' },
  separator: { height: 1, backgroundColor: '#F3F4F6', marginLeft: 30 },
  
  // 🔥 NEW GRID STYLES 🔥
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start' },
  gridItem: { width: '31%', backgroundColor: '#FFF', paddingVertical: 20, paddingHorizontal: 10, borderRadius: 16, marginBottom: 12, alignItems: 'center', elevation: 2, borderWidth: 1, borderColor: '#F3F4F6', shadowColor: '#000', shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.05, shadowRadius: 2 },
  gridIconBox: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  gridText: { fontSize: 11, fontWeight: '700', color: '#4B5563', textAlign: 'center' },
  
  emptyText: { color: '#9CA3AF', textAlign: 'center', padding: 20, fontStyle: 'italic' },
  userListHeaderContainer: { paddingHorizontal: 20, paddingTop: 15, paddingBottom: 15, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  addUserBtnOutline: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#C7D2FE', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 8 },
  addUserBtnText: { color: '#6366F1', fontWeight: 'bold', fontSize: 14, marginLeft: 5 },
  searchBarContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', margin: 20, marginBottom: 0, paddingHorizontal: 15, borderRadius: 10, borderWidth: 1, borderColor: '#E5E7EB', height: 45 },
  searchInput: { flex: 1, marginLeft: 10, fontSize: 15, color: '#111827' },
  customUserCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 20, marginBottom: 15, borderWidth: 1, borderColor: '#E5E7EB', elevation: 1 },
  customUserCardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  customUserIconBox: { width: 50, height: 50, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  customUserInfo: { flex: 1, justifyContent: 'center' },
  customUserName: { fontSize: 18, fontWeight: 'bold', color: '#111827' },
  customUserEmail: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  customRoleBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  customRoleBadgeText: { fontSize: 11, fontWeight: 'bold' },
  customUserMiddleRow: { marginTop: 15 },
  customUserDetailItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  customUserDetailText: { fontSize: 14, color: '#4B5563', fontWeight: '600' },
  customUserBottomRow: { flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', marginTop: 15, flexWrap: 'wrap' },
  customActionBtnEdit: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#C7D2FE', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 8, marginRight: 10, marginBottom: 8 },
  customActionBtnTextEdit: { color: '#6366F1', fontWeight: 'bold', fontSize: 13 },
  customActionBtnDelete: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#FECACA', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 8, marginRight: 10, marginBottom: 8 },
  customActionBtnTextDelete: { color: '#EF4444', fontWeight: 'bold', fontSize: 13 },
  customActionBtnPerm: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#FDE68A', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 8, marginRight: 10, marginBottom: 8, backgroundColor: '#FFFBEB' },
  customActionBtnTextPerm: { color: '#D97706', fontWeight: 'bold', fontSize: 13 },
  drawerDivider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 15 },
  addWhBox: { width: '90%', maxHeight: '80%', backgroundColor: '#FFF', borderRadius: 16, padding: 20, elevation: 10 },
  inputLabel: { fontSize: 12, fontWeight: 'bold', color: '#6B7280', marginBottom: 5 },
  smallLabel: { fontSize: 12, fontWeight: '700', color: '#4B5563', marginBottom: 6 },
  textInput: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, padding: 12, fontSize: 14, color: '#111827' },
  inputErrorBorder: { borderColor: '#EF4444', borderWidth: 1.5 },
  errorText: { color: '#EF4444', fontSize: 12, marginTop: 4, marginLeft: 5, fontWeight: '500' },
  roleSelectionRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 5 },
  roleChip: { paddingVertical: 10, paddingHorizontal: 15, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, alignItems: 'center', marginRight: 8, marginBottom: 8 },
  roleChipActive: { backgroundColor: '#EEF2FF', borderColor: '#4F46E5' },
  roleChipText: { fontSize: 12, fontWeight: 'bold', color: '#6B7280' },
  roleChipTextActive: { color: '#4F46E5' },
  saveWhBtn: { backgroundColor: '#4F46E5', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 20 },
  saveWhBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  modalOverlay: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  sideDrawer: { width: '75%', backgroundColor: '#FFF', height: '100%', paddingVertical: 20, paddingHorizontal: 15, elevation: 10, marginRight: 'auto' },
  closeOverlayArea: { flex: 1 },
  drawerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25, marginTop: 10, paddingHorizontal: 5 },
  drawerTitle: { fontSize: 24, fontWeight: 'bold', color: '#111827' },
  drawerMenuBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10, borderRadius: 10, marginBottom: 5 },
  drawerMenuText: { fontSize: 16, fontWeight: 'bold', color: '#111827', marginLeft: 15 },
  permHeaderSubtitle: { fontSize: 10, fontWeight: 'bold', color: '#9CA3AF', letterSpacing: 1 },
  permHeaderTitle: { fontSize: 24, fontWeight: 'bold', color: '#111827', marginTop: 2 },
  permHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  permHeaderUser: { fontSize: 13, color: '#6B7280', marginTop: 4, fontWeight: '600' },
  permActionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  permRoleBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EEF2FF', borderWidth: 1, borderColor: '#C7D2FE', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  permRoleBtnText: { color: '#4F46E5', fontWeight: '700', marginLeft: 8, fontSize: 13 },
  permResetBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  permResetBtnText: { color: '#6B7280', fontWeight: '700', marginLeft: 8, fontSize: 13 },
  permTabsRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E5E7EB', backgroundColor: '#FFF' },
  permTab: { flex: 1, flexDirection: 'row', paddingVertical: 15, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  permTabActive: { borderBottomColor: '#4F46E5' },
  permTabText: { fontSize: 13, fontWeight: 'bold', color: '#9CA3AF' },
  permTabTextActive: { color: '#4F46E5' },
  permSectionLabel: { fontSize: 12, fontWeight: 'bold', color: '#9CA3AF', letterSpacing: 0.5 },
  permSectionSubLabel: { fontSize: 13, color: '#6B7280', marginTop: 6, marginBottom: 14 },
  accordionContainer: { backgroundColor: '#FFF', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 12, overflow: 'hidden' },
  accordionHeader: { paddingHorizontal: 16, paddingVertical: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  accordionTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  accordionBody: { borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#FCFCFD' },
  permOptionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  permOptionText: { fontSize: 14, color: '#6B7280', textTransform: 'capitalize' },
  orderCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 15, marginBottom: 15, borderWidth: 1, borderColor: '#E5E7EB', elevation: 1 },
  orderTitle: { fontSize: 16, fontWeight: 'bold', color: '#111827' },
  orderMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  orderSubtitle: { fontSize: 13, color: '#6B7280' },
  orderInfoBlock: { marginTop: 14, backgroundColor: '#F9FAFB', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#F3F4F6' },
  orderSectionTitle: { fontSize: 12, fontWeight: 'bold', color: '#4B5563', marginBottom: 8, textTransform: 'uppercase' },
  orderListRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  orderListDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4F46E5', marginTop: 7, marginRight: 8 },
  orderListText: { flex: 1, fontSize: 13, color: '#374151', lineHeight: 19 },
  orderActionRow: { flexDirection: 'row', justifyContent: 'flex-start', marginTop: 15, borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingTop: 12 },
  startBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFBEB', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#FDE68A' },
  startBtnText: { color: '#D97706', fontWeight: 'bold', fontSize: 13 },
  completeBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ECFDF5', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#A7F3D0' },
  completeBtnText: { color: '#10B981', fontWeight: 'bold', fontSize: 13 },
  repeatCard: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, marginBottom: 12 },
  removeMiniBtn: { marginTop: 12, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  removeMiniBtnText: { color: '#EF4444', fontWeight: '700', fontSize: 12, marginLeft: 6 },
  workerListCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', padding: 15, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#F3F4F6' },
  workerListName: { fontSize: 16, fontWeight: 'bold', color: '#111827' },
  workerListRole: { fontSize: 11, color: '#4F46E5', marginTop: 4, fontWeight: 'bold' },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF', padding: 15, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#F3F4F6' },
  historyDateBox: { flexDirection: 'row', alignItems: 'center' },
  historyDate: { fontSize: 15, fontWeight: 'bold', color: '#111827', marginLeft: 8 },
  historyTime: { fontSize: 15, fontWeight: 'bold', color: '#10B981' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#111827' },
  warehouseCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 15, marginBottom: 15, borderWidth: 1, borderColor: '#E5E7EB', elevation: 1 },
  whHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  whTitle: { fontSize: 18, fontWeight: 'bold', color: '#111827', flex: 1 },
  whAddress: { fontSize: 13, color: '#6B7280', marginTop: 6, marginBottom: 5 },
  editBtnBox: { width: 34, height: 34, borderRadius: 8, justifyContent: 'center', alignItems: 'center', backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE' },
  matRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  matDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#9CA3AF', marginRight: 10 },
  matName: { flex: 1, fontSize: 14, color: '#4B5563', fontWeight: '500' },
  matAmount: { fontSize: 14, color: '#111827', fontWeight: 'bold' },
  dynamicRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  removeRowBtn: { padding: 8 },
  addMoreBtn: { flexDirection: 'row', alignItems: 'center', marginVertical: 10, padding: 6, paddingHorizontal: 4, alignSelf: 'flex-start' },
  addMoreText: { color: '#4F46E5', fontWeight: 'bold', marginLeft: 5, fontSize: 14 },
  deleteConfirmBox: { width: '85%', backgroundColor: '#FFF', borderRadius: 16, padding: 20, elevation: 10 },
  deleteHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  deleteModalTitle: { fontSize: 18, fontWeight: 'bold', color: '#EF4444' },
  deleteModalDesc: { fontSize: 14, color: '#4B5563', lineHeight: 20 },
  manageCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#E5E7EB', flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  manageCardActive: { backgroundColor: '#EEF2FF', borderColor: '#4F46E5' },
  manageCardTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 2 },
  manageCardSub: { fontSize: 12, color: '#6B7280' },
  boldSubTitle: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  permChip: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E5E7EB', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginRight: 8, marginBottom: 8 },
  permChipActive: { backgroundColor: '#EEF2FF', borderColor: '#4F46E5' },
  permChipText: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  permChipTextActive: { color: '#4F46E5' },
  chipRowGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  permGridChip: { width: '48%', backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E5E7EB', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, marginBottom: 10 },
  productCard: { backgroundColor: '#FFF', borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: '#E5E7EB', overflow: 'hidden' },
  productCardTop: { flexDirection: 'row', padding: 15 },
  productImagePlaceholder: { width: 80, height: 80, backgroundColor: '#F3F4F6', borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  productInfo: { flex: 1, justifyContent: 'center' },
  productName: { fontSize: 16, fontWeight: 'bold', color: '#111827', marginBottom: 4 },
  productCategory: { fontSize: 12, color: '#6B7280', marginBottom: 8 },
  productPrice: { fontSize: 16, fontWeight: 'bold', color: '#10B981' },
  productCardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 15, paddingBottom: 15 },
  stockText: { fontSize: 13, fontWeight: 'bold' },
  inStock: { color: '#10B981' },
  outOfStock: { color: '#EF4444' },
  formSection: { backgroundColor: '#FFF', borderRadius: 12, padding: 15, marginBottom: 15, borderWidth: 1, borderColor: '#E5E7EB' },
  formSectionTitle: { fontSize: 14, fontWeight: 'bold', color: '#111827', marginBottom: 15, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', paddingBottom: 8 },
  imageUploadBox: { borderStyle: 'dashed', borderWidth: 2, borderColor: '#C7D2FE', borderRadius: 10, backgroundColor: '#EEF2FF', padding: 30, alignItems: 'center' },
  uploadBoxText: { fontSize: 14, fontWeight: 'bold', color: '#4F46E5', marginTop: 10 },
  uploadBoxSub: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  chatRoomCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 15, marginBottom: 12, borderWidth: 1, borderColor: '#E5E7EB', flexDirection: 'row', alignItems: 'center' },
  chatRoomIcon: { width: 45, height: 45, borderRadius: 12, backgroundColor: '#EEF2FF', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  chatRoomName: { fontSize: 16, fontWeight: 'bold', color: '#111827' },
  chatRoomSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  chatHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 15, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E5E7EB', zIndex: 10 },
  chatHeaderTitle: { fontSize: 18, fontWeight: 'bold', color: '#111827' },
  chatHeaderSub: { fontSize: 12, color: '#6B7280' },
  messagesContainer: { flex: 1, backgroundColor: '#F3F4F6' },
  msgWrapper: { marginBottom: 15, maxWidth: '85%' }, 
  msgWrapperMe: { alignSelf: 'flex-end' },
  msgWrapperThem: { alignSelf: 'flex-start' },
  msgSenderName: { fontSize: 11, color: '#6B7280', marginBottom: 4, marginLeft: 2, fontWeight: '600' },
  msgBubble: { padding: 12, borderRadius: 16, position: 'relative', minWidth: 60 }, 
  msgBubbleMe: { backgroundColor: '#6366F1', borderBottomRightRadius: 4 },
  msgBubbleThem: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E5E7EB', borderBottomLeftRadius: 4 },
  msgText: { fontSize: 15, lineHeight: 22, paddingBottom: 15 }, 
  msgTextMe: { color: '#FFF' },
  msgTextThem: { color: '#111827' },
  msgTime: { fontSize: 10, position: 'absolute', bottom: 5, right: 10, fontWeight: '500' },
  msgTimeMe: { color: 'rgba(255,255,255,0.7)' },
  msgTimeThem: { color: '#9CA3AF' },
  msgImageContent: { width: 200, height: 200, borderRadius: 8, marginTop: 5 },
  msgVideoContent: { width: 200, height: 120, backgroundColor: '#F9FAFB', borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB', marginTop: 5 },
  msgVideoText: { fontSize: 12, color: '#6B7280', marginTop: 5 },
  msgDocContent: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.05)', padding: 10, borderRadius: 8, marginTop: 5 },
  msgDocText: { fontSize: 14, fontWeight: '500' },
  msgContactContent: { backgroundColor: '#F9FAFB', padding: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center', marginTop: 5, borderWidth: 1, borderColor: '#E5E7EB'},
  msgContactName: { fontSize: 15, fontWeight: 'bold', color: '#111827' },
  msgContactPhone: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  msgAudioContent: { flexDirection: 'row', alignItems: 'center', marginTop: 5 },
  msgAudioText: { fontSize: 14, fontWeight: '500' },
  chatInputContainer: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#E5E7EB', zIndex: 10 },
  chatInputBar: { flex: 1, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 20, paddingHorizontal: 15, paddingTop: 12, paddingBottom: 12, fontSize: 15, maxHeight: 100, color: '#111827' },
  chatAttachBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', marginRight: 5 },
  chatMicBtn: { width: 45, height: 45, borderRadius: 25, backgroundColor: '#6B7280', justifyContent: 'center', alignItems: 'center', marginLeft: 10, marginBottom: 2 },
  chatMicBtnRecording: { backgroundColor: '#EF4444' },
  chatSendBtn: { width: 45, height: 45, borderRadius: 25, backgroundColor: '#4F46E5', justifyContent: 'center', alignItems: 'center', marginLeft: 10, marginBottom: 2 },
  inviteCard: { backgroundColor: '#FFF', borderRadius: 10, padding: 15, marginBottom: 10, borderWidth: 1, borderColor: '#E5E7EB' },
  inviteCardActive: { borderColor: '#4F46E5', backgroundColor: '#EEF2FF' },
  inviteCheckbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: '#D1D5DB', marginRight: 15, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF' },
  inviteCheckboxActive: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  inviteName: { fontSize: 15, fontWeight: 'bold', color: '#111827' },
  inviteRole: { fontSize: 11, color: '#6B7280', marginTop: 2, fontWeight: '600' },
  chatLoaderOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.8)', zIndex: 1000, justifyContent: 'center', alignItems: 'center' },
  chatLoaderText: { color: '#4F46E5', marginTop: 15, fontWeight: 'bold' },
  attachMenuOverlay: { position: 'absolute', bottom: 70, left: 15, right: 15, backgroundColor: '#FFF', borderRadius: 16, padding: 15, elevation: 10, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', zIndex: 999, borderWidth: 1, borderColor: '#E5E7EB' },
  attachOption: { width: '23%', alignItems: 'center', marginBottom: 10 },
  attachIcon: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  attachText: { fontSize: 11, color: '#4B5563', fontWeight: '600' },
  recordStatusBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#EF4444', paddingVertical: 8 },
  recordStatusText: { color: '#FFF', fontSize: 12, fontWeight: 'bold' },
  saveRoleEditBtn: { backgroundColor: '#EEF2FF', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
  saveRoleEditBtnText: { color: '#4F46E5', fontWeight: 'bold', fontSize: 14 },
  settingsMenuOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent', zIndex: 100 },
  settingsMenuBox: { position: 'absolute', top: 60, right: 15, backgroundColor: '#FFF', borderRadius: 12, padding: 10, elevation: 5, borderWidth: 1, borderColor: '#E5E7EB', width: 200 },
  attachOptionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10 },
  attachTextRow: { fontSize: 14, color: '#111827', fontWeight: '500' },
  
  logCard: { backgroundColor: '#FFF', padding: 15, borderRadius: 10, marginBottom: 12, borderWidth: 1, borderColor: '#E5E7EB', borderLeftWidth: 4, borderLeftColor: '#4F46E5' },
  logAction: { fontSize: 15, fontWeight: 'bold', color: '#111827' },
  logDetails: { fontSize: 13, color: '#4B5563', marginTop: 4 },
  logMetaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  logUser: { fontSize: 11, color: '#6B7280', fontWeight: 'bold' },
  logTime: { fontSize: 11, color: '#9CA3AF' },

  // 🔥 NEW ALERTS STYLES 🔥
  targetTab: { flex: 1, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: '#E5E7EB', alignItems: 'center' },
  targetTabActive: { borderBottomColor: '#4F46E5' },
  targetTabText: { fontSize: 13, fontWeight: '600', color: '#6B7280' },
  targetTabTextActive: { color: '#4F46E5' },
});