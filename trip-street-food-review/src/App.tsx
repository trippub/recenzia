/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, Component } from 'react';
import { Camera, ChevronDown, Info, Star, CheckCircle2, X, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db, storage } from './firebase';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import { collection, query, orderBy, onSnapshot, deleteDoc, doc, Timestamp, getDocFromServer } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// --- Types ---
type Step = 'stars' | 'form' | 'success' | 'admin';

interface Review {
  id: string;
  rating: number;
  food: number;
  service: number;
  atmosphere: number;
  message: string;
  contact: string;
  ip: string;
  photos?: string[];
  createdAt: Timestamp;
}

interface RatingProps {
  label?: string;
  value: number;
  onChange: (val: number) => void;
}

// --- Components ---
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('ErrorBoundary caught an error', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center p-6 text-center">
          <div className="bg-[#252525] p-8 rounded-3xl max-w-md border border-red-500/30">
            <h2 className="text-2xl font-bold text-red-500 mb-4">Ups! Niečo sa pokazilo.</h2>
            <p className="text-gray-400 mb-6">
              Aplikácia narazila na neočakávanú chybu. Skúste stránku obnoviť.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-blue-600 rounded-full text-white font-medium"
            >
              Obnoviť stránku
            </button>
            {process.env.NODE_ENV !== 'production' && (
              <pre className="mt-6 p-4 bg-black/50 rounded-lg text-xs text-red-400 overflow-auto text-left">
                {this.state.error?.message}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const StarRating = ({ label, value, onChange }: RatingProps) => {
  return (
    <div className="flex items-center justify-between py-3">
      {label && <span className="text-gray-200 text-lg">{label}</span>}
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => onChange(star)}
            className="focus:outline-none"
          >
            <Star
              size={32}
              strokeWidth={1}
              className={`${
                star <= value ? 'fill-yellow-400 text-yellow-400' : 'text-gray-500'
              } transition-colors`}
            />
          </button>
        ))}
      </div>
    </div>
  );
};

const Chip = ({ 
  label, 
  selected, 
  onClick 
}: { 
  label: string; 
  selected: boolean; 
  onClick: () => void 
}) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 rounded-lg border text-sm transition-all ${
      selected 
        ? 'bg-blue-900/30 border-blue-400 text-blue-400' 
        : 'border-gray-700 text-gray-300 hover:bg-gray-800'
    }`}
  >
    {label}
  </button>
);

const Accordion = ({ title }: { title: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="border-b border-gray-800">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-4 text-gray-200"
      >
        <span className="text-lg">{title}</span>
        <ChevronDown className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden pb-4 text-gray-400 text-sm"
          >
            Možnosti pre {title.toLowerCase()}...
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- Main App ---
function MainApp() {
  const [step, setStep] = useState<Step>('stars');
  const [mainRating, setMainRating] = useState(0);
  const [foodRating, setFoodRating] = useState(0);
  const [serviceRating, setServiceRating] = useState(0);
  const [atmosphereRating, setAtmosphereRating] = useState(0);
  const [complaint, setComplaint] = useState('');
  const [contact, setContact] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  // Google Maps Review URL for TriP street food & Pub
  const GOOGLE_MAPS_REVIEW_URL = 'https://g.page/r/CUHUY4vDgv8DEBM/review';

  useEffect(() => {
    // Test Firestore connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Check environment variable first
        if (u.email === import.meta.env.VITE_ADMIN_EMAIL) {
          setIsAdmin(true);
          return;
        }
        
        // Fallback to Firestore role check
        try {
          const userDoc = await getDocFromServer(doc(db, 'users', u.uid));
          if (userDoc.exists() && userDoc.data().role === 'admin') {
            setIsAdmin(true);
            return;
          }
        } catch (error) {
          console.error('Error checking admin role:', error);
        }
      }
      setIsAdmin(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isAdmin && step === 'admin') {
      const q = query(collection(db, 'reviews'), orderBy('createdAt', 'desc'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const revs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Review));
        setReviews(revs);
      }, (error) => {
        console.error('Firestore error:', error);
      });
      return () => unsubscribe();
    }
  }, [isAdmin, step]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  const handleDeleteReview = async (id: string) => {
    if (window.confirm('Naozaj chcete vymazať túto recenziu?')) {
      try {
        await deleteDoc(doc(db, 'reviews', id));
      } catch (error) {
        console.error('Delete error:', error);
      }
    }
  };

  const handleMainRating = (rating: number) => {
    setMainRating(rating);
    if (rating >= 4) {
      // Scenario A: Positive
      window.open(GOOGLE_MAPS_REVIEW_URL, '_blank');
      setStep('success');
    } else {
      // Scenario B: Negative (1-3 stars)
      setStep('form');
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      const newPhotos = [...photos];
      for (const file of Array.from(files) as File[]) {
        if (newPhotos.length >= 5) break;
        const storageRef = ref(storage, `reviews/${Date.now()}_${file.name}`);
        const snapshot = await uploadBytes(storageRef, file);
        const url = await getDownloadURL(snapshot.ref);
        newPhotos.push(url);
      }
      setPhotos(newPhotos);
    } catch (error) {
      console.error('Photo upload error:', error);
      alert('Nepodarilo sa nahrať fotky.');
    } finally {
      setIsUploading(false);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(photos.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (complaint.length < 10) return;

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: mainRating,
          food: foodRating,
          service: serviceRating,
          atmosphere: atmosphereRating,
          message: complaint,
          contact: contact,
          photos: photos,
        }),
      });

      if (response.ok) {
        setStep('success');
      } else {
        const data = await response.json();
        alert(data.error || 'Nastala chyba pri odosielaní.');
      }
    } catch (error) {
      console.error('Error submitting feedback:', error);
      alert('Nepodarilo sa pripojiť k serveru.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#1a1a1a] text-white font-sans selection:bg-blue-500/30">
      <AnimatePresence mode="wait">
        {/* Step 2 & 3: Review Interface */}
        {(step === 'stars' || step === 'form') && (
          <motion.div
            key="review"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="pb-24"
          >
            {/* Header */}
            <header className="sticky top-0 z-10 bg-[#1a1a1a]/80 backdrop-blur-md px-4 py-4 flex items-center justify-center border-b border-gray-800">
              <h1 className="text-xl font-medium">TriP street food & Pub</h1>
            </header>

            <main className="max-w-xl mx-auto px-4 pt-6 space-y-8">
              {/* User Info / Context Text */}
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-teal-600 flex items-center justify-center text-xl font-bold shrink-0">
                  A
                </div>
                <div>
                  <h2 className="font-medium text-lg">Angelo Mohajer</h2>
                  <div className="flex items-center gap-1 text-gray-400 text-sm">
                    {step === 'stars' ? (
                      <>
                        <span>Obsah bude verejný v službách Googlu</span>
                        <Info size={16} />
                      </>
                    ) : (
                      <span className="text-yellow-400/80">Interná spätná väzba pre majiteľa</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Main Star Rating */}
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex gap-3">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button key={star} onClick={() => handleMainRating(star)}>
                      <Star
                        size={40}
                        strokeWidth={1}
                        className={`${
                          star <= mainRating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-500'
                        } transition-all active:scale-125`}
                      />
                    </button>
                  ))}
                </div>
                {mainRating > 0 && mainRating <= 3 && (
                  <p className="text-yellow-400 text-sm font-medium animate-pulse">
                    Mrzí nás to. Povedzte nám, čo môžeme zlepšiť.
                  </p>
                )}
              </div>

              {/* Detailed Ratings (Only for negative/form) */}
              {(step === 'form' || (mainRating > 0 && mainRating <= 3)) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="space-y-1"
                >
                  <StarRating label="Jedlo" value={foodRating} onChange={setFoodRating} />
                  <StarRating label="Obsluha" value={serviceRating} onChange={setServiceRating} />
                  <StarRating label="Atmosféra" value={atmosphereRating} onChange={setAtmosphereRating} />
                </motion.div>
              )}

              {/* Form Fields */}
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-400 ml-1">Vaša správa (povinné)</label>
                  <textarea
                    value={complaint}
                    onChange={(e) => setComplaint(e.target.value)}
                    placeholder="Podeľte sa o vlastné skúsenosti s týmto miestom (min. 10 znakov)"
                    className="w-full bg-[#252525] border border-gray-700 rounded-2xl p-4 min-h-[150px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none placeholder:text-gray-600 transition-all"
                  />
                  {complaint.length > 0 && complaint.length < 10 && (
                    <p className="text-red-400 text-xs ml-1">Zostáva ešte {10 - complaint.length} znakov.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-400 ml-1">E-mail alebo telefón (voliteľné)</label>
                  <input
                    type="text"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="Pre účely kompenzácie"
                    className="w-full bg-[#252525] border border-gray-700 rounded-2xl p-4 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none placeholder:text-gray-600 transition-all"
                  />
                </div>

                {/* Photo Upload */}
                <div className="space-y-4">
                  <label className="text-sm font-medium text-gray-400 ml-1">Pridať fotky (max. 5)</label>
                  <div className="flex flex-wrap gap-3">
                    {photos.map((url, idx) => (
                      <div key={idx} className="relative w-20 h-20 rounded-xl overflow-hidden group">
                        <img src={url} alt="Review" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        <button
                          onClick={() => removePhoto(idx)}
                          className="absolute top-1 right-1 bg-black/60 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    {photos.length < 5 && (
                      <label className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-700 flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 transition-colors">
                        <input type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />
                        {isUploading ? (
                          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <>
                            <Camera size={24} className="text-gray-500" />
                            <span className="text-[10px] text-gray-600 mt-1">Pridať</span>
                          </>
                        )}
                      </label>
                    )}
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <div className="fixed bottom-0 left-0 right-0 p-4 bg-[#1a1a1a]/95 backdrop-blur-md border-t border-gray-800 flex justify-center z-20">
                <button 
                  onClick={handleSubmit}
                  disabled={complaint.length < 10 || isSubmitting}
                  className={`w-full max-w-xl py-4 rounded-2xl font-bold text-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${
                    complaint.length >= 10 && !isSubmitting
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' 
                      : 'bg-[#3d3d3d] text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {isSubmitting ? (
                    <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    'Odoslať spätnú väzbu'
                  )}
                </button>
              </div>
            </main>
          </motion.div>
        )}

        {/* Step 4: Success Screen */}
        {step === 'success' && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1a1a1a]"
          >
            <div className="text-center space-y-6 max-w-md">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', damping: 12 }}
                className="w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center mx-auto"
              >
                <CheckCircle2 className="text-green-500" size={56} />
              </motion.div>
              <div className="space-y-3">
                <h2 className="text-3xl font-bold">Ďakujeme!</h2>
                <p className="text-gray-400 text-lg leading-relaxed">
                  Vašu spätnú väzbu sme prijali. Ďakujeme, že nám pomáhate sa zlepšovať.
                </p>
              </div>
              <button
                onClick={() => window.location.reload()}
                className="px-8 py-3 bg-[#2d2d2d] hover:bg-[#3d3d3d] rounded-full text-gray-300 transition-colors"
              >
                Zavrieť
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 5: Admin Dashboard */}
        {step === 'admin' && isAdmin && (
          <motion.div
            key="admin"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="min-h-screen bg-[#1a1a1a] pb-10"
          >
            <header className="sticky top-0 z-10 bg-[#1a1a1a]/80 backdrop-blur-md px-4 py-4 flex items-center justify-between border-b border-gray-800">
              <div className="flex items-center gap-4">
                <h1 className="text-xl font-bold">Administrácia recenzií</h1>
              </div>
              <button
                onClick={() => auth.signOut()}
                className="text-sm text-gray-400 hover:text-white"
              >
                Odhlásiť sa
              </button>
            </header>

            <main className="max-w-4xl mx-auto p-4 space-y-4">
              {reviews.length === 0 ? (
                <div className="text-center py-20 text-gray-500">
                  Zatiaľ žiadne interné recenzie.
                </div>
              ) : (
                reviews.map((rev) => (
                  <div key={rev.id} className="bg-[#252525] rounded-2xl p-6 border border-white/5 space-y-4">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2">
                        <div className="flex">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star
                              key={s}
                              size={16}
                              strokeWidth={1}
                              className={s <= rev.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-600'}
                            />
                          ))}
                        </div>
                        <span className="text-xs text-gray-500">
                          {rev.createdAt?.toDate().toLocaleString('sk-SK')}
                        </span>
                      </div>
                      <button
                        onClick={() => handleDeleteReview(rev.id)}
                        className="text-gray-600 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="bg-black/20 p-2 rounded-lg">
                        <span className="text-gray-500 block">Jedlo</span>
                        <span className="font-bold">{rev.food}/5</span>
                      </div>
                      <div className="bg-black/20 p-2 rounded-lg">
                        <span className="text-gray-500 block">Obsluha</span>
                        <span className="font-bold">{rev.service}/5</span>
                      </div>
                      <div className="bg-black/20 p-2 rounded-lg">
                        <span className="text-gray-500 block">Atmosféra</span>
                        <span className="font-bold">{rev.atmosphere}/5</span>
                      </div>
                    </div>

                    <p className="text-gray-200 leading-relaxed italic">"{rev.message}"</p>

                    {rev.photos && rev.photos.length > 0 && (
                      <div className="flex gap-2 overflow-x-auto pb-2">
                        {rev.photos.map((url, idx) => (
                          <img
                            key={idx}
                            src={url}
                            alt="Review"
                            className="w-24 h-24 rounded-lg object-cover shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() => window.open(url, '_blank')}
                            referrerPolicy="no-referrer"
                          />
                        ))}
                      </div>
                    )}

                    <div className="pt-2 border-t border-white/5 flex justify-between items-center text-xs text-gray-500">
                      <span>Kontakt: <span className="text-blue-400">{rev.contact || 'Neuvedený'}</span></span>
                      <span>IP: {rev.ip}</span>
                    </div>
                  </div>
                ))
              )}
            </main>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}
