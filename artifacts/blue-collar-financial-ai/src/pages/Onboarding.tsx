import React from 'react';
import { useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Check, ShieldCheck, ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useStore, PayFrequency, FilingContext } from '@/lib/store';

const formSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  payFrequency: z.enum(['Weekly', 'Bi-Weekly', 'Semi-Monthly', 'Monthly']),
  hourlyRate: z.coerce.number().min(1, 'Hourly rate must be greater than 0'),
  filingContext: z.enum(['Single', 'Married', 'Head of Household']),
  privacyConsent: z.boolean().refine(val => val === true, { message: 'Must acknowledge privacy policy' })
});

export default function Onboarding() {
  const [_, setLocation] = useLocation();
  const { updateProfile } = useStore();
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      payFrequency: 'Weekly',
      hourlyRate: 0,
      filingContext: 'Single',
      privacyConsent: false
    }
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    updateProfile({
      name: values.name,
      payFrequency: values.payFrequency as PayFrequency,
      hourlyRate: values.hourlyRate,
      filingContext: values.filingContext as FilingContext,
      hasCompletedOnboarding: true
    });
    setLocation('/dashboard');
  };

  return (
    <div className="min-h-[100dvh] w-full bg-slate-50 dark:bg-slate-950 flex flex-col md:justify-center">
      <div className="flex-1 w-full max-w-md mx-auto p-6 flex flex-col justify-center">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Setup your profile</h1>
          <p className="text-slate-600 dark:text-slate-400">We need a few details to calculate your pay correctly.</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>First Name</FormLabel>
                  <FormControl>
                    <Input placeholder="John" className="h-12 bg-white dark:bg-slate-900 text-lg" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="hourlyRate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Base Hourly Rate</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="absolute left-3 top-3.5 text-slate-500 font-medium">$</span>
                        <Input type="number" step="0.01" className="h-12 pl-7 bg-white dark:bg-slate-900 text-lg" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="payFrequency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pay Frequency</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-12 bg-white dark:bg-slate-900">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Weekly">Weekly</SelectItem>
                        <SelectItem value="Bi-Weekly">Bi-Weekly</SelectItem>
                        <SelectItem value="Semi-Monthly">Semi-Monthly</SelectItem>
                        <SelectItem value="Monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="filingContext"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tax Filing Status</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="h-12 bg-white dark:bg-slate-900">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Single">Single</SelectItem>
                      <SelectItem value="Married">Married</SelectItem>
                      <SelectItem value="Head of Household">Head of Household</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>Used to estimate tax withholdings.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="bg-slate-100 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
              <FormField
                control={form.control}
                name="privacyConsent"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        className="mt-1 w-5 h-5 rounded-md border-slate-400"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="text-base font-medium">I understand data is stored locally</FormLabel>
                      <FormDescription className="text-sm">
                        Everything entered is saved only on this device. Clearing browser data will delete it.
                      </FormDescription>
                    </div>
                  </FormItem>
                )}
              />
            </div>

            <Button type="submit" size="lg" className="w-full h-14 text-lg bg-emerald-600 hover:bg-emerald-700 text-white">
              Complete Setup <ArrowRight className="ml-2 w-5 h-5" />
            </Button>

          </form>
        </Form>
      </div>
    </div>
  );
}
